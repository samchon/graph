import type { ISamchonGraphNode } from "../structures";
import type { GraphNodeKind } from "../typings";

export namespace ZigDeclarations {
  export interface IZigDeclaration {
    kind: GraphNodeKind;
    name: string;
    endIndex: number;
    ownerNames?: string[];
    exported?: boolean;
    modifiers?: ISamchonGraphNode["modifiers"];
  }

  export interface IZigImport {
    binding: string;
    name: string;
  }

  interface IScope {
    kind: GraphNodeKind;
    owners: string[];
    endIndex: number;
    bodyDepth: number;
    capture: boolean;
  }

  interface IHeader {
    source: string;
    endIndex: number;
  }

  const IDENTIFIER = "[A-Za-z_]\\w*";
  const CALLABLE_KINDS = new Set<GraphNodeKind>([
    "constructor",
    "function",
    "method",
  ]);
  const TYPE_KINDS = new Set<GraphNodeKind>([
    "class",
    "enum",
    "interface",
  ]);

  /**
   * Scan Zig declarations with their lexical owners. Zig's named types are
   * values (`const Parser = struct { ... }`), and public functions may live in
   * an anonymous container returned from a type factory. A brace-only shared
   * parser cannot distinguish either shape from an ordinary local value.
   */
  export function scan(
    lines: readonly string[],
  ): ReadonlyMap<number, IZigDeclaration> {
    const lexical = zigLexicalLines(lines);
    const depthBefore = braceDepths(lexical);
    const declarations = new Map<number, IZigDeclaration>();
    const scopes: IScope[] = [];
    let headerContinuation = -1;

    for (let index = 0; index < lines.length; index++) {
      while (scopes.length > 0 && index > scopes.at(-1)!.endIndex) scopes.pop();
      if (index <= headerContinuation) continue;

      const scope = scopes.at(-1);
      const direct =
        scope === undefined
          ? depthBefore[index] === 0
          : depthBefore[index] === scope.bodyDepth;
      const header = zigHeaderOf(lines, lexical, index);
      const ownerKind = scope?.kind;
      const parsed = parseZigDeclaration(
        header.source,
        scope?.owners.at(-1),
        ownerKind,
      );

      if (parsed !== undefined && direct && (scope?.capture ?? true)) {
        const owners = scope?.owners ?? [];
        declarations.set(index, {
          ...parsed,
          endIndex: zigDeclarationEndIndex(lines, index),
          ...(owners.length > 0 ? { ownerNames: [...owners] } : {}),
        });
      }

      const rawBinding = bindingDeclaration(header.source);
      const declaration = parsed ?? rawBinding;
      if (declaration !== undefined && direct) {
        const endIndex = zigDeclarationEndIndex(lines, index);
        const body = bodyStart(lines, lexical, index, header.endIndex);
        if (
          body !== undefined &&
          endIndex > body.line &&
          (TYPE_KINDS.has(declaration.kind) ||
            CALLABLE_KINDS.has(declaration.kind))
        ) {
          const included = (scope?.capture ?? true) && parsed !== undefined;
          scopes.push({
            kind: declaration.kind,
            owners: [
              ...(scope?.owners ?? []),
              ...(included ? [declaration.name] : []),
            ],
            endIndex,
            bodyDepth: depthBefore[body.line]! + 1,
            capture: included && !CALLABLE_KINDS.has(declaration.kind),
          });
        }
        headerContinuation = Math.max(headerContinuation, header.endIndex);
        continue;
      }

      const test = direct ? testDeclaration(header.source) : undefined;
      if (test !== undefined && (scope?.capture ?? true)) {
        const endIndex = zigDeclarationEndIndex(lines, index);
        const owners = scope?.owners ?? [];
        declarations.set(index, {
          ...test,
          endIndex,
          ...(owners.length > 0 ? { ownerNames: [...owners] } : {}),
        });
        const body = bodyStart(lines, lexical, index, header.endIndex);
        if (body !== undefined && endIndex > body.line) {
          scopes.push({
            kind: "function",
            owners: [...owners, test.name],
            endIndex,
            bodyDepth: depthBefore[body.line]! + 1,
            capture: false,
          });
        }
        headerContinuation = Math.max(headerContinuation, header.endIndex);
        continue;
      }

      // A public type factory commonly returns `struct { ... }`. Its members
      // belong to the factory's stable identity even though the container has
      // no declared name of its own. Other anonymous containers in a callable
      // are local implementation details and remain suppressed.
      if (scope !== undefined && !scope.capture) {
        const returned = returnedContainer(header.source);
        if (returned !== undefined) {
          const endIndex = zigDeclarationEndIndex(lines, index);
          const body = bodyStart(lines, lexical, index, header.endIndex);
          if (body !== undefined && endIndex > body.line) {
            scopes.push({
              kind: returned,
              owners: [...scope.owners],
              endIndex,
              bodyDepth: depthBefore[body.line]! + 1,
              capture: true,
            });
          }
          headerContinuation = Math.max(headerContinuation, header.endIndex);
        }
      }
    }
    return declarations;
  }

  /** Join one bounded Zig declaration head split across parameters or a RHS. */
  export function zigDeclarationHeader(
    lines: readonly string[],
    start: number,
  ): string {
    return zigHeaderOf(lines, zigLexicalLines(lines), start).source;
  }

  /**
   * Bound a Zig declaration while ignoring braces in comments, quoted
   * literals, character literals, and `\\` multiline-string lines.
   */
  export function zigDeclarationEndIndex(
    lines: readonly string[],
    start: number,
  ): number {
    const lexical = zigLexicalLines(lines);
    const callable = startsFunction(lexical[start] ?? "");
    const commaTerminated = startsCommaDeclaration(lexical[start] ?? "");
    let braces = 0;
    let typeBraces = 0;
    let sawBody = false;
    let parentheses = 0;
    let brackets = 0;
    let prefix = "";
    for (let index = start; index < lines.length; index++) {
      const source = lexical[index]!;
      for (let cursor = 0; cursor < source.length; cursor++) {
        const char = source[cursor]!;
        if (char === "(") parentheses++;
        else if (char === ")") parentheses = Math.max(0, parentheses - 1);
        else if (char === "[") brackets++;
        else if (char === "]") brackets = Math.max(0, brackets - 1);
        else if (char === "{" && parentheses === 0 && brackets === 0) {
          if (typeBraces > 0) typeBraces++;
          else if (
            (callable || commaTerminated) &&
            opensSignatureContainer(prefix)
          )
            typeBraces = 1;
          else {
            braces++;
            sawBody = true;
          }
        } else if (
          char === "}" &&
          parentheses === 0 &&
          brackets === 0 &&
          typeBraces > 0
        ) {
          typeBraces--;
        } else if (
          char === "}" &&
          parentheses === 0 &&
          brackets === 0 &&
          braces > 0
        ) {
          braces--;
          if (sawBody && braces === 0) return index;
        } else if (
          char === ";" &&
          !sawBody &&
          parentheses === 0 &&
          brackets === 0
        ) {
          return index;
        } else if (
          char === "," &&
          commaTerminated &&
          !sawBody &&
          parentheses === 0 &&
          brackets === 0 &&
          typeBraces === 0
        ) {
          return index;
        }
        prefix += char;
      }
      prefix += "\n";
    }
    return start;
  }

  /** Parse one Zig declaration without manufacturing callable-local values. */
  export function parseZigDeclaration(
    source: string,
    _ownerName?: string,
    ownerKind?: GraphNodeKind,
  ): Omit<IZigDeclaration, "endIndex" | "ownerNames"> | undefined {
    const clean = zigLexicalText(source).trim();
    if (clean === "") return undefined;
    const callable = functionDeclaration(clean);
    if (callable !== undefined) {
      const kind: GraphNodeKind = TYPE_KINDS.has(ownerKind ?? "file")
        ? "method"
        : "function";
      return withFacts({ kind, name: callable.name }, clean, ownerKind);
    }

    const binding = bindingDeclaration(clean);
    if (binding !== undefined) {
      if (CALLABLE_KINDS.has(ownerKind ?? "file")) return undefined;
      return withFacts(binding, clean, ownerKind);
    }

    if (TYPE_KINDS.has(ownerKind ?? "file")) {
      const field = new RegExp(
        `^(?:comptime\\s+)?(${IDENTIFIER})\\s*:(?!:)`,
      ).exec(clean);
      if (field !== null) {
        return {
          kind: "field",
          name: field[1]!,
          modifiers: ["public"],
        };
      }
      if (ownerKind === "enum") {
        const enumCase = new RegExp(`^(${IDENTIFIER})(?=\\s*(?:=|,|\\}))`).exec(
          clean,
        )?.[1];
        if (enumCase !== undefined) {
          return {
            kind: "field",
            name: enumCase,
            modifiers: ["public", "const"],
          };
        }
      }
    }
    return undefined;
  }

  /** Zig module imports are ordinary const declarations around `@import`. */
  export function zigImportsOf(source: string): IZigImport[] {
    const lexical = zigLexicalText(source);
    const out: IZigImport[] = [];
    const pattern = new RegExp(
      `^\\s*(?:pub\\s+)?const\\s+(${IDENTIFIER})\\s*=\\s*@import\\(\\s*"((?:\\\\.|[^"\\\\])*)"\\s*\\)\\s*;`,
      "gm",
    );
    for (let match = pattern.exec(source); match !== null; match = pattern.exec(source)) {
      const quote = match.index + match[0]!.indexOf('"');
      if (!lexical.slice(match.index, quote).includes("@import")) continue;
      out.push({ binding: match[1]!, name: unescapeString(match[2]!) });
    }
    return out;
  }

  /** Names the source file actually publishes through Zig's `pub`/`export`. */
  export function zigPublishedNames(source: string): Set<string> {
    const declarations = scan(source.split(/\r?\n/));
    return new Set(
      [...declarations.values()]
        .filter(
          (declaration) =>
            declaration.ownerNames === undefined && declaration.exported === true,
        )
        .map((declaration) => declaration.name),
    );
  }

  /** Every comma-separated Zig enum/error-set field in one declaration body. */
  export function zigEnumFieldNames(source: string): string[] {
    const clean = zigLexicalText(source);
    const open = clean.indexOf("{");
    const close = clean.lastIndexOf("}");
    if (open === -1 || close <= open) return [];
    const out: string[] = [];
    for (const part of splitTopLevel(clean.slice(open + 1, close), ",")) {
      const name = new RegExp(`^\\s*(${IDENTIFIER})(?=\\s*(?:=|$))`).exec(
        part,
      )?.[1];
      if (name !== undefined) out.push(name);
    }
    return out;
  }

  /** Recover the common modifier vocabulary from a Zig declaration head. */
  export function zigGraphModifiersOf(
    source: string,
    field = false,
  ): NonNullable<ISamchonGraphNode["modifiers"]> {
    const clean = zigLexicalText(source).trim();
    const out: NonNullable<ISamchonGraphNode["modifiers"]> = [];
    const add = (modifier: NonNullable<ISamchonGraphNode["modifiers"]>[number]) => {
      if (!out.includes(modifier)) out.push(modifier);
    };
    if (field || /\b(?:pub|export)\b/.test(declarationPrefix(clean)))
      add("public");
    else add("private");
    if (/\bexport\b/.test(declarationPrefix(clean))) add("export");
    if (/\bconst\b/.test(declarationPrefix(clean))) add("const");
    if (/\b(?:const|var)\b/.test(declarationPrefix(clean)) && field)
      add("static");
    return out;
  }

  /** Replace Zig non-code with spaces without changing offsets or newlines. */
  export function zigLexicalText(source: string): string {
    return zigLexicalLines(source.split(/\r?\n/)).join("\n");
  }

  function zigLexicalLines(lines: readonly string[]): string[] {
    return lines.map((line) => {
      const chars = line.split("");
      const first = line.search(/\S/);
      if (first !== -1 && line.startsWith("\\\\", first)) {
        for (let index = first; index < chars.length; index++) chars[index] = " ";
        return chars.join("");
      }
      for (let index = 0; index < line.length; ) {
        if (line.startsWith("//", index)) {
          for (let cursor = index; cursor < chars.length; cursor++)
            chars[cursor] = " ";
          break;
        }
        const quote = line[index];
        if (quote === '"' || quote === "'") {
          chars[index] = " ";
          index++;
          while (index < line.length) {
            chars[index] = " ";
            if (line[index] === "\\") {
              if (++index < line.length) chars[index] = " ";
            } else if (line[index] === quote) {
              index++;
              break;
            }
            index++;
          }
          continue;
        }
        index++;
      }
      return chars.join("");
    });
  }

  function zigHeaderOf(
    lines: readonly string[],
    lexical: readonly string[],
    start: number,
  ): IHeader {
    const first = lexical[start]!.trim();
    if (!declarationStart(first)) {
      return { source: lines[start]!, endIndex: start };
    }
    let parentheses = 0;
    let brackets = 0;
    let typeBraces = 0;
    const callable = startsFunction(first);
    const commaTerminated = startsCommaDeclaration(first);
    let prefix = "";
    const out: string[] = [];
    for (let index = start; index < Math.min(lines.length, start + 96); index++) {
      out.push(lines[index]!.trim());
      for (const char of lexical[index]!) {
        if (char === "(") parentheses++;
        else if (char === ")") parentheses = Math.max(0, parentheses - 1);
        else if (char === "[") brackets++;
        else if (char === "]") brackets = Math.max(0, brackets - 1);
        else if (char === "{" && parentheses === 0 && brackets === 0) {
          if (typeBraces > 0) typeBraces++;
          else if (
            (callable || commaTerminated) &&
            opensSignatureContainer(prefix)
          )
            typeBraces = 1;
          else return { source: out.join(" "), endIndex: index };
        } else if (
          char === "}" &&
          parentheses === 0 &&
          brackets === 0 &&
          typeBraces > 0
        )
          typeBraces--;
        else if (
          char === ";" &&
          parentheses === 0 &&
          brackets === 0 &&
          typeBraces === 0
        ) {
          return { source: out.join(" "), endIndex: index };
        } else if (
          char === "," &&
          commaTerminated &&
          parentheses === 0 &&
          brackets === 0 &&
          typeBraces === 0
        ) {
          return { source: out.join(" "), endIndex: index };
        }
        prefix += char;
      }
      prefix += "\n";
      if (
        parentheses === 0 &&
        brackets === 0 &&
        typeBraces === 0 &&
        completeWithoutTerminator(out.join(" "))
      ) {
        return { source: out.join(" "), endIndex: index };
      }
    }
    return {
      source: out.join(" "),
      endIndex: Math.min(lines.length - 1, start + out.length - 1),
    };
  }

  function declarationStart(source: string): boolean {
    return /^(?:(?:pub|export|extern(?:\s+"[^"]*")?|inline|noinline|threadlocal)\s+)*(?:fn|const|var)\b/.test(
      source,
    ) || /^(?:comptime\s+)?[A-Za-z_]\w*\s*:/.test(source) ||
      /^test\b/.test(source) ||
      /^return\s+(?:(?:packed|extern)\s+)?(?:struct|enum|union|opaque|error)\b/.test(
        source,
      );
  }

  function completeWithoutTerminator(source: string): boolean {
    return /^test\s+"[^"]*"$/.test(source.trim());
  }

  function functionDeclaration(
    source: string,
  ): { name: string } | undefined {
    const match = new RegExp(
      `^(?:(?:pub|export|extern(?:\\s+"[^"]*")?|inline|noinline)\\s+)*fn\\s+(${IDENTIFIER})(?=\\s*\\()`,
    ).exec(source);
    return match === null ? undefined : { name: match[1]! };
  }

  function bindingDeclaration(
    source: string,
  ): Omit<IZigDeclaration, "endIndex" | "ownerNames"> | undefined {
    const match = new RegExp(
      `^(?:(?:pub|export|extern(?:\\s+"[^"]*")?|threadlocal)\\s+)*(const|var)\\s+(${IDENTIFIER})\\b([\\s\\S]*)$`,
    ).exec(source.trim());
    if (match === null) return undefined;
    const tail = match[3]!;
    const assigned = /^\s*(?::[^=;]+)?=\s*(?:packed\s+|extern\s+)?(struct|enum|union|opaque|error)\b/.exec(
      tail,
    );
    const kind: GraphNodeKind =
      assigned?.[1] === "enum" || assigned?.[1] === "error"
        ? "enum"
        : assigned !== null
          ? "class"
          : "variable";
    return {
      kind,
      name: match[2]!,
      modifiers: zigGraphModifiersOf(source, false),
    };
  }

  function withFacts(
    declaration: Pick<IZigDeclaration, "kind" | "name">,
    source: string,
    ownerKind: GraphNodeKind | undefined,
  ): Omit<IZigDeclaration, "endIndex" | "ownerNames"> {
    const modifiers = zigGraphModifiersOf(source, false);
    return {
      ...declaration,
      ...(ownerKind === undefined && modifiers.includes("public")
        ? { exported: true }
        : {}),
      modifiers,
    };
  }

  function testDeclaration(
    source: string,
  ): Omit<IZigDeclaration, "endIndex" | "ownerNames"> | undefined {
    const named = new RegExp(
      `^test\\s+(?:"((?:\\\\.|[^"\\\\])*)"|(${IDENTIFIER}))`,
    ).exec(source.trim());
    if (named === null) return undefined;
    return {
      // ZLS reports Zig test declarations as methods. Keeping that stable kind
      // also prevents `test "parse"` from colliding with a top-level `fn parse`.
      kind: "method",
      name: named[1] === undefined ? named[2]! : unescapeString(named[1]),
      modifiers: ["private"],
    };
  }

  function returnedContainer(source: string): GraphNodeKind | undefined {
    const token = /^return\s+(?:packed\s+|extern\s+)?(struct|enum|union|opaque|error)\b/.exec(
      source.trim(),
    )?.[1];
    return token === undefined
      ? undefined
      : token === "enum" || token === "error"
        ? "enum"
        : "class";
  }

  function bodyStart(
    lines: readonly string[],
    lexical: readonly string[],
    start: number,
    headerEnd: number,
  ): { line: number; column: number } | undefined {
    let parentheses = 0;
    let brackets = 0;
    let typeBraces = 0;
    const callable = startsFunction(lexical[start]!);
    let prefix = "";
    for (let line = start; line <= headerEnd; line++) {
      for (let column = 0; column < lexical[line]!.length; column++) {
        const char = lexical[line]![column]!;
        if (char === "(") parentheses++;
        else if (char === ")") parentheses = Math.max(0, parentheses - 1);
        else if (char === "[") brackets++;
        else if (char === "]") brackets = Math.max(0, brackets - 1);
        else if (char === "{" && parentheses === 0 && brackets === 0) {
          if (typeBraces > 0) typeBraces++;
          else if (callable && opensSignatureContainer(prefix)) typeBraces = 1;
          else return { line, column };
        } else if (
          char === "}" &&
          parentheses === 0 &&
          brackets === 0 &&
          typeBraces > 0
        )
          typeBraces--;
        prefix += char;
      }
      prefix += "\n";
    }
    const next = nextCodeLine(lexical, headerEnd + 1);
    if (next !== undefined) {
      const column = lexical[next]!.indexOf("{");
      if (column !== -1 && lexical[next]!.slice(0, column).trim() === "")
        return { line: next, column };
    }
    return undefined;
  }

  function braceDepths(lines: readonly string[]): number[] {
    const out: number[] = [];
    let depth = 0;
    for (const line of lines) {
      out.push(depth);
      for (const char of line) {
        if (char === "{") depth++;
        else if (char === "}") depth = Math.max(0, depth - 1);
      }
    }
    return out;
  }

  function startsFunction(source: string): boolean {
    return /^(?:(?:pub|export|extern|inline|noinline)\s+)*fn\b/.test(
      source.trim(),
    );
  }

  function startsCommaDeclaration(source: string): boolean {
    return /^(?:comptime\s+)?[A-Za-z_]\w*\s*(?::|=|,)/.test(source.trim());
  }

  function opensSignatureContainer(prefix: string): boolean {
    return /\b(?:struct|enum|opaque|error)\s*$|\bunion\s*(?:\([^{}]*\))?\s*$/.test(
      prefix,
    );
  }

  function declarationPrefix(source: string): string {
    const match = /\b(?:fn|const|var)\b/.exec(source);
    return match === null ? source : source.slice(0, match.index + match[0].length);
  }

  function splitTopLevel(source: string, separator: string): string[] {
    const out: string[] = [];
    let start = 0;
    let parentheses = 0;
    let brackets = 0;
    let braces = 0;
    for (let index = 0; index < source.length; index++) {
      const char = source[index]!;
      if (char === "(") parentheses++;
      else if (char === ")") parentheses = Math.max(0, parentheses - 1);
      else if (char === "[") brackets++;
      else if (char === "]") brackets = Math.max(0, brackets - 1);
      else if (char === "{") braces++;
      else if (char === "}") braces = Math.max(0, braces - 1);
      else if (
        char === separator &&
        parentheses === 0 &&
        brackets === 0 &&
        braces === 0
      ) {
        out.push(source.slice(start, index));
        start = index + 1;
      }
    }
    out.push(source.slice(start));
    return out;
  }

  function nextCodeLine(
    lines: readonly string[],
    start: number,
  ): number | undefined {
    for (let index = start; index < lines.length; index++) {
      if (lines[index]!.trim() !== "") return index;
    }
    return undefined;
  }

  function unescapeString(source: string): string {
    return source.replace(/\\([\\"'])/g, "$1");
  }
}
