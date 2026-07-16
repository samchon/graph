import { ISamchonGraphNode } from "../structures";
import { GraphNodeKind } from "../typings";

export namespace ScalaDeclarations {
  export interface IScalaDeclaration {
    kind: GraphNodeKind;
    name: string;
    ownerNames: string[];
    endIndex: number;
    exported?: boolean;
    modifiers?: ISamchonGraphNode["modifiers"];
  }

  export interface IScalaExport {
    /** Lexical template that publishes the selected members. */
    ownerNames: string[];
    /** Receiver/path written after `export`. */
    target: string;
    names: Array<{ name: string; alias?: string }>;
  }

  interface IScope {
    endIndex: number;
    kind?: GraphNodeKind;
    name?: string;
    transparent?: true;
  }

  export interface IScalaParsedDeclaration {
    kind: GraphNodeKind;
    name: string;
    modifiers: NonNullable<ISamchonGraphNode["modifiers"]>;
  }

  interface ILexicalState {
    blockCommentDepth: number;
    quote?: "\"" | "'" | "\"\"\"";
  }

  const IDENTIFIER = "(?:`[^`]+`|[A-Za-z_$][\\w$]*)";
  const CALLABLE_OWNER_KINDS = new Set<GraphNodeKind>([
    "function",
    "method",
    "constructor",
  ]);
  const TYPE_OWNER_KINDS = new Set<GraphNodeKind>([
    "class",
    "interface",
    "enum",
    "module",
  ]);

  /**
   * Parse Scala 3 declarations using both braces and significant indentation.
   * Transparent `extension` regions affect the ranges of their methods but do
   * not manufacture a graph node that Metals itself does not report.
   */
  export function scan(
    lines: readonly string[],
  ): ReadonlyMap<number, IScalaDeclaration> {
    const lexical = scalaLexicalLines(lines);
    const declarations = new Map<number, IScalaDeclaration>();
    const scopes: IScope[] = [];

    for (let index = 0; index < lexical.length; index++) {
      while (scopes.length > 0 && index > scopes.at(-1)!.endIndex) scopes.pop();
      const text = lexical[index]!.trim();
      if (text === "" || /^end(?:\s|$)/.test(text)) continue;

      if (isExtensionHead(text)) {
        const headerEnd = scalaHeaderEndIndex(lexical, index);
        const endIndex = scalaDeclarationEndIndex(lexical, index, headerEnd);
        if (endIndex > headerEnd)
          scopes.push({ endIndex, transparent: true });
        continue;
      }

      const headerEnd = scalaHeaderEndIndex(lexical, index);
      const header = lexical.slice(index, headerEnd + 1).join(" ").trim();
      const ownerScopes = scopes.filter(
        (scope): scope is IScope & { name: string; kind: GraphNodeKind } =>
          scope.transparent !== true &&
          scope.name !== undefined &&
          scope.kind !== undefined,
      );
      const ownerKind = ownerScopes.at(-1)?.kind;
      const parsed = parseScalaDeclaration(header, ownerKind);
      if (parsed === undefined) continue;

      const endIndex = scalaDeclarationEndIndex(lexical, index, headerEnd);
      const ownerNames = ownerScopes.map((scope) => scope.name);
      const local = ownerScopes.some((scope) =>
        CALLABLE_OWNER_KINDS.has(scope.kind),
      );
      const modifiers = local ? [] : parsed.modifiers;
      const exported =
        ownerNames.length === 0 &&
        isPublished(modifiers);
      declarations.set(index, {
        kind: parsed.kind,
        name: parsed.name,
        ownerNames,
        endIndex,
        ...(exported ? { exported: true } : {}),
        ...(modifiers.length > 0 ? { modifiers } : {}),
      });

      if (isScope(parsed.kind) && endIndex > headerEnd) {
        const givenObject =
          (parsed.kind === "property" || parsed.kind === "variable") &&
          /^given(?:\s|\[)/.test(
            stripDeclarationModifiers(eraseLeadingAnnotations(header)),
          );
        scopes.push({
          name: parsed.name,
          kind: givenObject ? "class" : parsed.kind,
          endIndex,
        });
      }
    }
    return declarations;
  }

  /** Parse one Scala 3 declaration after its multiline head has been joined. */
  export function parseScalaDeclaration(
    source: string,
    ownerKind?: GraphNodeKind,
  ): IScalaParsedDeclaration | undefined {
    const annotated = eraseLeadingAnnotations(source.trim());
    if (annotated === "") return undefined;
    const declaration = stripDeclarationModifiers(annotated);
    const modifiers = scalaGraphModifiersOf(annotated, declaration, ownerKind);

    const packageDeclaration = new RegExp(
      `^package\\s+(${IDENTIFIER}(?:\\.${IDENTIFIER})*)\\s*(?::|$)`,
    ).exec(declaration);
    if (packageDeclaration !== null) {
      return {
        kind: "package",
        name: unquotePath(packageDeclaration[1]!),
        modifiers: ["public"],
      };
    }

    const type = new RegExp(
      `^(?:(case)\\s+)?(class|trait|enum|object)\\s+(${IDENTIFIER})(?=\\s|[\\[({:]|$)`,
    ).exec(declaration);
    if (type !== null) {
      return {
        kind:
          type[2] === "trait"
            ? "interface"
            : type[2] === "enum"
              ? "enum"
              : type[2] === "object"
                ? "module"
                : "class",
        name: unquote(type[3]!),
        modifiers,
      };
    }

    const typeAlias = new RegExp(
      `^(?:opaque\\s+)?type\\s+(${IDENTIFIER})(?=\\s|\\[|=|<|>)`,
    ).exec(declaration);
    if (typeAlias !== null) {
      return {
        kind: "type",
        name: unquote(typeAlias[1]!),
        modifiers,
      };
    }

    const callable = new RegExp(
      `^def\\s+(${IDENTIFIER}|this|[!#%&*+\\-/:<=>?@\\\\^|~]+)(?=\\s|[\\[(=:])`,
    ).exec(declaration);
    if (callable !== null) {
      const constructor = callable[1] === "this";
      return {
        kind: constructor
          ? "constructor"
          : TYPE_OWNER_KINDS.has(ownerKind ?? "file")
            ? "method"
            : "function",
        name: constructor ? "this" : unquote(callable[1]!),
        modifiers,
      };
    }

    const binding = new RegExp(
      `^(lazy\\s+)?(val|var)\\s+(${IDENTIFIER})(?=\\s|:|=)`,
    ).exec(declaration);
    if (binding !== null) {
      return {
        kind: TYPE_OWNER_KINDS.has(ownerKind ?? "file")
          ? "property"
          : "variable",
        name: unquote(binding[3]!),
        modifiers: addReadonly(modifiers, binding[2] === "val"),
      };
    }

    if (/^given(?:\s|\[)/.test(declaration)) {
      const given = givenIdentity(declaration);
      if (given === undefined) return undefined;
      return {
        // Metals exposes both value and method-shaped givens as stable
        // bindings. Keep that identity across the static and LSP lanes; the
        // declaration's signature still carries its type/using parameters.
        kind: TYPE_OWNER_KINDS.has(ownerKind ?? "file")
          ? "property"
          : "variable",
        name: given.name,
        modifiers: addReadonly(modifiers, true),
      };
    }
    return undefined;
  }

  /** Join a Scala declaration head split over type, using, or value parameters. */
  export function scalaDeclarationHeader(
    lines: readonly string[],
    start: number,
  ): string {
    const lexical = scalaLexicalLines(lines);
    const end = scalaHeaderEndIndex(lexical, start);
    return lines.slice(start, end + 1).map((line) => line.trim()).join(" ");
  }

  /** Return the full brace/indentation range owned by a Scala declaration. */
  export function scalaDeclarationEndIndex(
    lexicalLines: readonly string[],
    start: number,
    headerEnd: number = scalaHeaderEndIndex(lexicalLines, start),
  ): number {
    const braceEnd = bracedEndIndex(lexicalLines, start, headerEnd);
    if (braceEnd !== undefined && braceEnd > headerEnd) return braceEnd;

    const header = lexicalLines.slice(start, headerEnd + 1).join(" ").trim();
    if (!canOwnIndentedBody(header)) return headerEnd;
    const baseIndent = leadingWhitespace(lexicalLines[start]!);
    const first = nextCodeLine(lexicalLines, headerEnd + 1);
    if (
      first === undefined ||
      leadingWhitespace(lexicalLines[first]!) <= baseIndent
    )
      return headerEnd;

    let end = first;
    for (let index = first + 1; index < lexicalLines.length; index++) {
      const text = lexicalLines[index]!;
      if (text.trim() === "") continue;
      const indentation = leadingWhitespace(text);
      if (indentation < baseIndent) break;
      if (indentation === baseIndent) {
        if (/^\s*end(?:\s|$)/.test(text)) end = index;
        break;
      }
      end = index;
    }
    return end;
  }

  /** Parse Scala 3 export clauses, including selectors renamed with `as`. */
  export function exportsOf(
    lines: readonly string[],
  ): ReadonlyMap<number, IScalaExport> {
    const lexical = scalaLexicalLines(lines);
    const declarations = [...scan(lines)].map(([index, declaration]) => ({
      index,
      declaration,
    }));
    const out = new Map<number, IScalaExport>();
    for (let index = 0; index < lexical.length; index++) {
      const declaration = lexical[index]!.trim();
      if (!declaration.startsWith("export ")) continue;
      const rest = declaration.slice("export ".length).trim();
      const dot = rest.includes(".{")
        ? rest.indexOf(".{")
        : rest.lastIndexOf(".");
      if (dot <= 0) continue;
      const owner = rest.slice(0, dot);
      if (!owner.split(".").every(isPlainIdentifier)) continue;
      const selector = rest.slice(dot + 1).trim();
      const values =
        selector.startsWith("{") && selector.endsWith("}")
          ? splitTopLevel(selector.slice(1, -1), ",")
          : [selector];
      const names = values.flatMap((value) => {
        const alias = /^(`[^`]+`|[A-Za-z_$][\w$]*|\*)\s+as\s+(`[^`]+`|[A-Za-z_$][\w$]*|_)$/.exec(
          value.trim(),
        );
        if (alias !== null && alias[2] !== "_")
          return [{ name: unquote(alias[1]!), alias: unquote(alias[2]!) }];
        const name = value.trim();
        return /^(?:`[^`]+`|[A-Za-z_$][\w$]*|\*)$/.test(name)
          ? [{ name: unquote(name) }]
          : [];
      });
      if (names.length > 0) {
        const enclosing = declarations
          .filter(
            (entry) =>
              entry.index < index &&
              entry.declaration.endIndex >= index &&
              isScope(entry.declaration.kind),
          )
          .sort(
            (left, right) =>
              right.declaration.ownerNames.length -
                left.declaration.ownerNames.length ||
              right.index - left.index,
          )[0];
        out.set(index, {
          ownerNames:
            enclosing === undefined
              ? []
              : [
                  ...enclosing.declaration.ownerNames,
                  enclosing.declaration.name,
                ],
          target: owner,
          names,
        });
      }
    }
    return out;
  }

  /** Blank comments and literals by line while retaining indentation/offsets. */
  export function scalaLexicalLines(lines: readonly string[]): string[] {
    const state: ILexicalState = { blockCommentDepth: 0 };
    return lines.map((line) => scalaLexicalLine(line, state));
  }

  /** Recover Scala visibility and graph-representable declaration modifiers. */
  export function scalaGraphModifiersOf(
    source: string,
    declaration: string = stripDeclarationModifiers(
      eraseLeadingAnnotations(source.trim()),
    ),
    ownerKind?: GraphNodeKind,
  ): NonNullable<ISamchonGraphNode["modifiers"]> {
    const prefix = source.slice(0, Math.max(0, source.indexOf(declaration)));
    const out: NonNullable<ISamchonGraphNode["modifiers"]> = [];
    if (/\bprivate(?:\[[^\]]+\])?\b/.test(prefix)) out.push("private");
    else if (/\bprotected(?:\[[^\]]+\])?\b/.test(prefix)) out.push("protected");
    else if (!CALLABLE_OWNER_KINDS.has(ownerKind ?? "file")) out.push("public");
    if (/\babstract\b/.test(prefix)) out.push("abstract");
    return out;
  }

  function scalaLexicalLine(source: string, state: ILexicalState): string {
    const output = source.split("");
    const blank = (index: number): void => {
      if (source[index] !== "\r" && source[index] !== "\n") output[index] = " ";
    };
    for (let index = 0; index < source.length; index++) {
      if (state.blockCommentDepth > 0) {
        blank(index);
        if (source.startsWith("/*", index)) {
          blank(index + 1);
          state.blockCommentDepth++;
          index++;
        } else if (source.startsWith("*/", index)) {
          blank(index + 1);
          state.blockCommentDepth--;
          index++;
        }
        continue;
      }
      if (state.quote !== undefined) {
        blank(index);
        if (state.quote === "\"\"\"" && source.startsWith("\"\"\"", index)) {
          blank(index + 1);
          blank(index + 2);
          state.quote = undefined;
          index += 2;
        } else if (state.quote !== "\"\"\"" && source[index] === "\\") {
          if (index + 1 < source.length) {
            blank(index + 1);
            index++;
          }
        } else if (source[index] === state.quote) state.quote = undefined;
        continue;
      }
      if (source.startsWith("//", index)) {
        for (; index < source.length; index++) blank(index);
        break;
      }
      if (source.startsWith("/*", index)) {
        blank(index);
        blank(index + 1);
        state.blockCommentDepth = 1;
        index++;
        continue;
      }
      const triple = source.startsWith("\"\"\"", index);
      if (triple || source[index] === '"' || source[index] === "'") {
        state.quote = triple ? "\"\"\"" : (source[index] as "\"" | "'");
        blank(index);
        if (triple) {
          blank(index + 1);
          blank(index + 2);
          index += 2;
        }
      }
    }
    return output.join("");
  }

  function scalaHeaderEndIndex(lines: readonly string[], start: number): number {
    let parentheses = 0;
    let brackets = 0;
    const declaration = stripDeclarationModifiers(
      eraseLeadingAnnotations(lines[start]!.trim()),
    );
    const given = /^given(?:\s|\[)/.test(declaration);
    for (let index = start; index < Math.min(lines.length, start + 64); index++) {
      for (const char of lines[index]!) {
        if (char === "(") parentheses++;
        else if (char === ")") parentheses = Math.max(0, parentheses - 1);
        else if (char === "[") brackets++;
        else if (char === "]") brackets = Math.max(0, brackets - 1);
      }
      const text = lines[index]!.trimEnd();
      if (
        parentheses === 0 &&
        brackets === 0 &&
        !/(?:extends|derives|,|=>)\s*$/.test(text) &&
        (given || !/\bwith\s*$/.test(text))
      )
        return index;
    }
    return start;
  }

  function bracedEndIndex(
    lines: readonly string[],
    start: number,
    headerEnd: number,
  ): number | undefined {
    let depth = 0;
    let entered = false;
    for (let index = start; index < lines.length; index++) {
      for (const char of lines[index]!) {
        if (char === "{") {
          depth++;
          entered = true;
        } else if (char === "}") depth = Math.max(0, depth - 1);
      }
      if (entered && depth === 0) return index;
      if (!entered && index >= headerEnd) return undefined;
    }
    return undefined;
  }

  function canOwnIndentedBody(header: string): boolean {
    const clean = eraseLeadingAnnotations(header);
    if (/^package\b/.test(clean)) return /:\s*$/.test(clean);
    if (/^extension\b/.test(clean)) return true;
    if (/^(?:given\b[\s\S]*\bwith|(?:case\s+)?(?:class|trait|enum|object)\b)/.test(
      stripDeclarationModifiers(clean),
    ))
      return /:\s*$/.test(clean) || /\bwith\s*$/.test(clean);
    return /=\s*(?:[^\n]*)$/.test(clean) || /:\s*$/.test(clean);
  }

  function givenIdentity(
    declaration: string,
  ): { name: string } | undefined {
    let rest = declaration.slice("given".length).trimStart();
    if (rest === "") return undefined;
    const named = new RegExp(`^(${IDENTIFIER})(?=\\s*[\\[(:])`).exec(rest);
    if (named !== null) {
      const after = rest.slice(named[0].length).trimStart();
      // `given Ordering[String]` is anonymous: a named generic given needs a
      // parameter/type-parameter list followed by `:`, `(`, or `using`.
      if (!after.startsWith("[") || followsNamedGiven(after)) {
        return {
          name: unquote(named[1]!),
        };
      }
    }
    const colon = topLevelIndex(rest, ":");
    if (colon !== -1) rest = rest.slice(colon + 1).trimStart();
    const provided = rest
      .replace(/^(?:\[[^\]]*\]\s*)?(?:\(using[\s\S]*?\)\s*)?/, "")
      .split(/\s+(?:with|derives)\b|\s*=/, 1)[0]!
      .trim();
    return provided === ""
      ? undefined
      : { name: `given ${normalizeType(provided)}` };
  }

  function followsNamedGiven(source: string): boolean {
    const close = matchingDelimiterEnd(source, 0, "[", "]");
    if (close === -1) return false;
    const rest = source.slice(close + 1).trimStart();
    return rest.startsWith("(") || rest.startsWith(":");
  }

  function eraseLeadingAnnotations(source: string): string {
    let out = source;
    while (out.startsWith("@")) {
      let end = 1;
      while (end < out.length && /[A-Za-z0-9_$.]/.test(out[end]!)) end++;
      if (end === 1) return out;
      while (/\s/.test(out[end] ?? "")) end++;
      if (out[end] === "(") {
        const close = matchingDelimiterEnd(out, end, "(", ")");
        if (close === -1) return "";
        end = close + 1;
      }
      out = out.slice(end).trimStart();
    }
    return out;
  }

  function stripDeclarationModifiers(source: string): string {
    let out = source;
    for (;;) {
      const modifier = /^(?:(?:private|protected)(?:\[[^\]]+\])?|public|final|sealed|abstract|open|override|inline|transparent|implicit|erased|lazy)\b\s*/.exec(
        out,
      );
      if (modifier === null) return out;
      out = out.slice(modifier[0].length).trimStart();
    }
  }

  function matchingDelimiterEnd(
    source: string,
    start: number,
    open: string,
    close: string,
  ): number {
    let depth = 0;
    for (let index = start; index < source.length; index++) {
      if (source[index] === open) depth++;
      else if (source[index] === close && --depth === 0) return index;
    }
    return -1;
  }

  function topLevelIndex(source: string, target: string): number {
    let parentheses = 0;
    let brackets = 0;
    for (let index = 0; index < source.length; index++) {
      const char = source[index]!;
      if (char === "(") parentheses++;
      else if (char === ")") parentheses = Math.max(0, parentheses - 1);
      else if (char === "[") brackets++;
      else if (char === "]") brackets = Math.max(0, brackets - 1);
      else if (char === target && parentheses === 0 && brackets === 0)
        return index;
    }
    return -1;
  }

  function splitTopLevel(source: string, separator: string): string[] {
    const out: string[] = [];
    let start = 0;
    let depth = 0;
    for (let index = 0; index < source.length; index++) {
      if ("([{<".includes(source[index]!)) depth++;
      else if (")]}>".includes(source[index]!)) depth = Math.max(0, depth - 1);
      else if (source[index] === separator && depth === 0) {
        out.push(source.slice(start, index));
        start = index + 1;
      }
    }
    out.push(source.slice(start));
    return out;
  }

  function addReadonly(
    modifiers: NonNullable<ISamchonGraphNode["modifiers"]>,
    readonly: boolean,
  ): NonNullable<ISamchonGraphNode["modifiers"]> {
    return readonly && !modifiers.includes("readonly")
      ? [...modifiers, "readonly"]
      : modifiers;
  }

  function isPublished(modifiers: readonly string[]): boolean {
    return (
      !modifiers.includes("private") && !modifiers.includes("protected")
    );
  }

  function isScope(kind: GraphNodeKind): boolean {
    return (
      TYPE_OWNER_KINDS.has(kind) ||
      CALLABLE_OWNER_KINDS.has(kind) ||
      kind === "property" ||
      kind === "variable" ||
      kind === "module" ||
      kind === "namespace"
    );
  }

  function isExtensionHead(source: string): boolean {
    return /^extension(?:\s|\[|\()/.test(
      stripDeclarationModifiers(eraseLeadingAnnotations(source)),
    );
  }

  function nextCodeLine(
    lines: readonly string[],
    start: number,
  ): number | undefined {
    for (let index = start; index < lines.length; index++)
      if (lines[index]!.trim() !== "") return index;
    return undefined;
  }

  function leadingWhitespace(source: string): number {
    return /^\s*/.exec(source)?.[0].length ?? 0;
  }

  function normalizeType(source: string): string {
    return source
      .replace(/\s+/g, " ")
      .replace(/\s*,\s*/g, ",")
      .replace(/\s*\[\s*/g, "[")
      .replace(/\s*\]\s*/g, "]");
  }

  function isPlainIdentifier(source: string): boolean {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(source);
  }

  function unquote(name: string): string {
    return name.startsWith("`") ? name.slice(1, -1) : name;
  }

  function unquotePath(name: string): string {
    return name.split(".").map(unquote).join(".");
  }
}
