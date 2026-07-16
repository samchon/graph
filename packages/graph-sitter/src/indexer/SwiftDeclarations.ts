import type { ISamchonGraphNode } from "../structures";
import type { GraphNodeKind } from "../typings";

export namespace SwiftDeclarations {
  export interface ISwiftDeclaration {
    kind: GraphNodeKind;
    name: string;
    exported?: boolean;
    modifiers?: ISamchonGraphNode["modifiers"];
    /** The canonical receiver of an extension, which is not a new type. */
    extensionOwner?: string;
    /** Dotted owners preceding the declaration's simple name. */
    ownerNames?: string[];
    decorators?: string[];
  }

  export interface ISwiftImport {
    name: string;
    module: string;
  }

  const TYPE_KINDS = new Set<GraphNodeKind>([
    "class",
    "enum",
    "interface",
    "type",
  ]);
  const TYPE_OWNERS = new Set<GraphNodeKind>([
    "class",
    "enum",
    "interface",
  ]);
  const CALLABLE_OWNERS = new Set<GraphNodeKind>([
    "constructor",
    "function",
    "method",
  ]);
  const DECLARATION_HEAD =
    /\b(?:actor|associatedtype|case|class|deinit|enum|extension|func|init[?!]?|let|operator|precedencegroup|protocol|struct|subscript|typealias|var)\b/;
  const IDENTIFIER = "(?:`[^`]+`|[A-Za-z_$][\\w$]*)";
  const TYPE_PATH = `${IDENTIFIER}(?:\\s*\\.\\s*${IDENTIFIER})*`;
  const OPERATOR = "[-+*/%=!<>&|^~?.]+";

  /**
   * Join one bounded Swift declaration head, including multiline attributes,
   * generic clauses, parameter lists, return types, and `where` constraints.
   */
  export function swiftDeclarationHeader(
    lines: readonly string[],
    start: number,
  ): string {
    return swiftHeaderOf(lines, start).source;
  }

  function swiftHeaderOf(
    lines: readonly string[],
    start: number,
  ): { source: string; endIndex: number } {
    const first = lines[start]?.trim() ?? "";
    if (
      first === "" ||
      first.startsWith("//") ||
      first.startsWith("/*") ||
      first.startsWith("*")
    )
      return { source: lines[start] ?? "", endIndex: start };
    if (
      first.startsWith("@") &&
      !DECLARATION_HEAD.test(
        eraseLeadingAttributes(swiftLexicalText(first)).trimStart(),
      )
    )
      return { source: lines[start] ?? "", endIndex: start };
    if (!DECLARATION_HEAD.test(swiftLexicalText(first))) {
      return { source: lines[start] ?? "", endIndex: start };
    }

    const out: string[] = [];
    let sawDeclaration = false;
    for (let index = start; index < Math.min(lines.length, start + 96); index++) {
      out.push(lines[index]!.trim());
      const joined = out.join("\n");
      const lexical = swiftLexicalText(joined);
      const declaration = eraseLeadingAttributes(lexical).trimStart();
      sawDeclaration ||= DECLARATION_HEAD.test(declaration);
      if (!sawDeclaration || !delimitersAreBalanced(lexical)) continue;
      const following = nextCodeLine(lines, index + 1);
      if (
        following !== undefined &&
        lines[following]!.trimStart().startsWith("where ")
      )
        continue;
      if (
        hasTopLevelBodyStart(declaration) ||
        swiftHeaderIsComplete(declaration)
      )
        return { source: out.join(" "), endIndex: index };
    }
    return {
      source: out.join(" "),
      endIndex: Math.min(lines.length - 1, start + out.length - 1),
    };
  }

  /**
   * Bound a Swift declaration without counting braces in nested comments,
   * raw strings, regex literals, or multiline string literals as source scope.
   */
  export function swiftDeclarationEndIndex(
    lines: readonly string[],
    start: number,
  ): number {
    const header = swiftHeaderOf(lines, start);
    const headerEnd = header.endIndex;
    const lexicalHeader = swiftLexicalText(
      lines.slice(start, headerEnd + 1).join("\n"),
    );
    let bodyLine = firstTopLevelBodyStart(lexicalHeader) === -1
      ? undefined
      : headerEnd;
    if (bodyLine === undefined) {
      const next = nextCodeLine(lines, headerEnd + 1);
      if (next !== undefined && lines[next]!.trimStart().startsWith("{")) {
        bodyLine = next;
      }
    }
    if (bodyLine === undefined) return headerEnd;

    const source = lines.slice(start).join("\n");
    const lexical = swiftLexicalText(source);
    const bodyStart = firstTopLevelBodyStart(lexical);
    if (bodyStart === -1) return headerEnd;

    let depth = 0;
    for (let index = bodyStart; index < lexical.length; index++) {
      const char = lexical[index]!;
      if (char === "{") depth++;
      else if (char === "}" && --depth === 0) {
        return start + lineCountBefore(source, index);
      }
    }
    return headerEnd;
  }

  /** Parse Swift declarations while keeping extensions as transparent owners. */
  export function parseSwiftDeclaration(
    source: string,
    ownerName?: string,
    ownerKind?: GraphNodeKind,
  ): ISwiftDeclaration | undefined {
    const lexical = swiftLexicalText(source);
    const decorators = swiftDecoratorNames(source);
    const clean = eraseLeadingAttributes(lexical).trim();
    if (clean === "") return undefined;
    const declaration = stripSwiftModifiers(clean);

    const extension = new RegExp(`^extension\\s+(${TYPE_PATH})(?=\\s|:|\\{|$)`).exec(
      declaration,
    );
    if (extension !== null) {
      const extensionOwner = normalizeTypePath(extension[1]!);
      const parts = extensionOwner.split(".");
      return withFacts(
        {
          kind: "class",
          name: parts.at(-1)!,
          extensionOwner,
          ...(parts.length > 1 ? { ownerNames: parts.slice(0, -1) } : {}),
        },
        clean,
        ownerKind,
        decorators,
      );
    }

    const type = new RegExp(
      `^(?:(indirect)\\s+)?(actor|class|struct|enum|protocol)\\s+(${IDENTIFIER})(?=\\s|[<:{]|$)`,
    ).exec(declaration);
    if (type !== null) {
      const kind: GraphNodeKind =
        type[2] === "protocol"
          ? "interface"
          : type[2] === "enum"
            ? "enum"
            : "class";
      return withFacts(
        { kind, name: unquote(type[3]!) },
        clean,
        ownerKind,
        decorators,
      );
    }

    const namedType = new RegExp(
      `^(associatedtype|typealias|precedencegroup)\\s+(${IDENTIFIER})(?=\\s|[<:{=]|$)`,
    ).exec(declaration);
    if (namedType !== null) {
      return withFacts(
        { kind: "type", name: unquote(namedType[2]!) },
        clean,
        ownerKind,
        decorators,
      );
    }

    const operator = new RegExp(
      `^(?:(?:prefix|infix|postfix)\\s+)?operator\\s+(${OPERATOR})(?=\\s|:|$)`,
    ).exec(declaration);
    if (operator !== null) {
      return withFacts(
        { kind: "function", name: operator[1]! },
        clean,
        ownerKind,
        decorators,
      );
    }

    const functionHead = new RegExp(
      `^func\\s+(${IDENTIFIER}|${OPERATOR})(?=\\s|<|\\()`,
    ).exec(declaration);
    if (functionHead !== null) {
      return withFacts(
        {
          kind: TYPE_OWNERS.has(ownerKind ?? "file") ? "method" : "function",
          name: unquote(functionHead[1]!),
        },
        clean,
        ownerKind,
        decorators,
      );
    }

    if (/^init[?!]?\s*(?:<|\()/.test(declaration)) {
      return withFacts(
        { kind: "constructor", name: "init" },
        clean,
        ownerKind,
        decorators,
      );
    }
    if (/^deinit\b/.test(declaration)) {
      return withFacts(
        { kind: "method", name: "deinit" },
        clean,
        ownerKind,
        decorators,
      );
    }
    if (/^subscript\s*(?:<|\()/.test(declaration)) {
      return withFacts(
        { kind: "method", name: "subscript" },
        clean,
        ownerKind,
        decorators,
      );
    }

    // A binding in a callable body is a local value, not a type property. The
    // static graph can recover its uses from the owning callable without
    // manufacturing a declaration that competes with the public API.
    if (CALLABLE_OWNERS.has(ownerKind ?? "file")) return undefined;
    const binding = new RegExp(`^(let|var)\\s+(${IDENTIFIER})(?=\\s|:|=|\\{|$)`).exec(
      declaration,
    );
    if (binding !== null) {
      return withFacts(
        {
          kind: TYPE_OWNERS.has(ownerKind ?? "file") ? "property" : "variable",
          name: unquote(binding[2]!),
        },
        clean,
        ownerKind,
        decorators,
      );
    }
    if (ownerKind === "enum") {
      const enumCase = swiftEnumCaseNames(declaration)[0];
      if (enumCase !== undefined) {
        return withFacts(
          { kind: "property", name: enumCase },
          clean,
          ownerKind,
          decorators,
        );
      }
    }
    return undefined;
  }

  /** Recover every comma-separated case name on one Swift `case` declaration. */
  export function swiftEnumCaseNames(source: string): string[] {
    const declaration = stripSwiftModifiers(
      eraseLeadingAttributes(swiftLexicalText(source)).trim(),
    );
    if (!declaration.startsWith("case ")) return [];
    const out: string[] = [];
    for (const item of splitTopLevel(declaration.slice("case ".length), ",")) {
      const match = new RegExp(`^\\s*(${IDENTIFIER})`).exec(item);
      if (match !== null) out.push(unquote(match[1]!));
    }
    return out;
  }

  /** Return the inherited type spellings from a type or extension head. */
  export function swiftInheritedTypes(source: string): string[] {
    const declaration = stripSwiftModifiers(
      eraseLeadingAttributes(swiftLexicalText(source)).trim(),
    );
    const head = /^(?:actor|class|struct|enum|protocol|extension)\b/.test(
      declaration,
    );
    if (!head) return [];
    const colon = topLevelIndexOf(declaration, ":");
    if (colon === -1) return [];
    const tail = declaration
      .slice(colon + 1)
      .replace(/\bwhere\b[\s\S]*$/, "")
      .replace(/\{[\s\S]*$/, "");
    return splitTopLevel(tail, ",")
      .map((part) =>
        part
          .trim()
          .replace(/^@(?:unchecked|preconcurrency)\s+/, "")
          .replace(/<[^<>]*>/g, "")
          .trim(),
      )
      .filter((part) => new RegExp(`^${TYPE_PATH}$`).test(part))
      .map(normalizeTypePath);
  }

  /** Swift protocol conformance is `implements`; protocol refinement extends. */
  export function swiftInheritanceRelation(
    sourceKind: GraphNodeKind,
    targetKind: GraphNodeKind,
  ): "extends" | "implements" {
    return sourceKind !== "interface" && targetKind === "interface"
      ? "implements"
      : "extends";
  }

  /** Parse normal and declaration-scoped Swift import forms. */
  export function parseSwiftImport(source: string): ISwiftImport | undefined {
    const declaration = eraseLeadingAttributes(swiftLexicalText(source)).trim();
    const match = new RegExp(
      `^import(?:\\s+(?:typealias|struct|class|enum|protocol|let|var|func))?\\s+(${TYPE_PATH})(?=\\s|$)`,
    ).exec(declaration);
    if (match === null) return undefined;
    const name = normalizeTypePath(match[1]!);
    return { name, module: name.split(".")[0]! };
  }

  /**
   * Tell the shared occurrence scanner whether a Swift identifier is followed
   * by a direct call or trailing closure rather than only a type occurrence.
   */
  export function isSwiftCallSuffix(source: string, afterName: number): boolean {
    let cursor = afterName;
    while (cursor < source.length && /\s/.test(source[cursor]!)) cursor++;
    if (source[cursor] === "(" || source[cursor] === "{") return true;
    if (source[cursor] !== "<") return false;
    const end = matchingDelimiter(source, cursor, "<", ">");
    if (end === -1) return false;
    cursor = end + 1;
    while (cursor < source.length && /\s/.test(source[cursor]!)) cursor++;
    return source[cursor] === "(" || source[cursor] === "{";
  }

  /** Map Swift access and member modifiers onto the graph's common vocabulary. */
  export function swiftGraphModifiersOf(
    source: string,
    kind?: GraphNodeKind,
    ownerKind?: GraphNodeKind,
  ): NonNullable<ISamchonGraphNode["modifiers"]> {
    const clean = eraseLeadingAttributes(swiftLexicalText(source)).trim();
    const declarationStart = DECLARATION_HEAD.exec(clean)?.index ?? clean.length;
    const prefix = clean.slice(0, declarationStart);
    const out: NonNullable<ISamchonGraphNode["modifiers"]> = [];
    const add = (modifier: NonNullable<ISamchonGraphNode["modifiers"]>[number]) => {
      if (!out.includes(modifier)) out.push(modifier);
    };

    if (/\b(?:open|public)\b/.test(prefix)) add("public");
    else if (/\b(?:fileprivate|private)\b(?!\s*\(set\))/.test(prefix))
      add("private");
    else add("internal");
    if (
      /\bstatic\b/.test(prefix) ||
      /\bclass\s+(?:func|subscript|var)\b/.test(clean)
    )
      add("static");
    if (kind === "interface" || ownerKind === "interface") add("abstract");
    if (/\basync\b/.test(clean)) add("async");
    if (/\boptional\b/.test(prefix) || /^@objc\s+optional\b/.test(source.trim()))
      add("optional");
    if (/\blet\b/.test(clean.slice(declarationStart))) add("readonly");
    return out;
  }

  export function isSwiftPublishedDeclaration(
    kind: GraphNodeKind,
    ownerKind: GraphNodeKind | undefined,
    modifiers: readonly string[] | undefined,
  ): boolean {
    return (
      ownerKind === undefined &&
      TYPE_KINDS.has(kind) &&
      modifiers?.includes("public") === true
    ) ||
      (ownerKind === undefined &&
        kind === "function" &&
        modifiers?.includes("public") === true) ||
      (ownerKind === undefined &&
        kind === "variable" &&
        modifiers?.includes("public") === true);
  }

  /** Leading Swift attributes, including underscored and dotted spellings. */
  export function swiftDecoratorNames(source: string): string[] {
    const lexical = swiftLexicalText(source);
    return leadingAttributes(lexical).names;
  }

  /** Recover stacked and multiline Swift attributes immediately above a node. */
  export function swiftDecoratorsAbove(
    lines: readonly string[],
    index: number,
  ): string[] {
    for (let start = Math.max(0, index - 64); start < index; start++) {
      if (!lines[start]!.trimStart().startsWith("@")) continue;
      const block = swiftLexicalText(lines.slice(start, index).join("\n"));
      const attributes = leadingAttributes(block);
      if (
        attributes.names.length > 0 &&
        block.slice(attributes.end).trim() === ""
      )
        return attributes.names;
    }
    return [];
  }

  function leadingAttributes(source: string): { names: string[]; end: number } {
    const names: string[] = [];
    let cursor = 0;
    while (cursor < source.length) {
      while (/\s/.test(source[cursor] ?? "")) cursor++;
      if (source[cursor] !== "@") break;
      const attribute = attributeNameAt(source, cursor);
      if (attribute === undefined) break;
      names.push(attribute.name);
      cursor = attribute.end;
      while (/\s/.test(source[cursor] ?? "")) cursor++;
      if (source[cursor] === "(") {
        const end = matchingDelimiter(source, cursor, "(", ")");
        if (end === -1) return { names, end: source.length };
        cursor = end + 1;
      }
    }
    return { names, end: cursor };
  }

  function withFacts(
    declaration: ISwiftDeclaration,
    source: string,
    ownerKind: GraphNodeKind | undefined,
    decorators: string[],
  ): ISwiftDeclaration {
    const modifiers = swiftGraphModifiersOf(
      source,
      declaration.kind,
      ownerKind,
    );
    return {
      ...declaration,
      ...(declaration.extensionOwner === undefined && isSwiftPublishedDeclaration(
        declaration.kind,
        ownerKind,
        modifiers,
      )
        ? { exported: true }
        : {}),
      ...(modifiers.length > 0 ? { modifiers } : {}),
      ...(decorators.length > 0 ? { decorators } : {}),
    };
  }

  function swiftHeaderEndIndex(
    lines: readonly string[],
    start: number,
  ): number {
    return swiftHeaderOf(lines, start).endIndex;
  }

  function swiftHeaderIsComplete(source: string): boolean {
    const text = source.trimEnd();
    if (/[,:=.]$/.test(text) || /(?:->|\bwhere)\s*$/.test(text)) return false;
    if (/^(?:case|let|var)\b/.test(stripSwiftModifiers(text))) return true;
    if (/^(?:associatedtype|typealias|operator|precedencegroup)\b/.test(
      stripSwiftModifiers(text),
    ))
      return true;
    return /^(?:actor|class|struct|enum|protocol|extension|func|init[?!]?|deinit|subscript)\b/.test(
      stripSwiftModifiers(text),
    );
  }

  function eraseLeadingAttributes(source: string): string {
    let cursor = 0;
    for (;;) {
      while (/\s/.test(source[cursor] ?? "")) cursor++;
      if (source[cursor] !== "@") break;
      const attribute = attributeNameAt(source, cursor);
      if (attribute === undefined) break;
      cursor = attribute.end;
      while (/\s/.test(source[cursor] ?? "")) cursor++;
      if (source[cursor] === "(") {
        const end = matchingDelimiter(source, cursor, "(", ")");
        if (end === -1) return "";
        cursor = end + 1;
      }
    }
    return source.slice(cursor);
  }

  function attributeNameAt(
    source: string,
    start: number,
  ): { name: string; end: number } | undefined {
    if (source[start] !== "@") return undefined;
    let cursor = start + 1;
    const segments: string[] = [];
    for (;;) {
      const segmentStart = cursor;
      if (!/[A-Za-z_$]/.test(source[cursor] ?? "")) return undefined;
      cursor++;
      while (/[A-Za-z0-9_$]/.test(source[cursor] ?? "")) cursor++;
      segments.push(source.slice(segmentStart, cursor));
      if (source[cursor] !== ".") break;
      cursor++;
    }
    return { name: segments.join("."), end: cursor };
  }

  function stripSwiftModifiers(source: string): string {
    let out = source.trimStart();
    for (;;) {
      const modifier = /^(?:open|public|package|internal|fileprivate|private|final|indirect|static|class(?=\s+(?:func|subscript|var)\b)|override|required|convenience|dynamic|optional|lazy|weak|unowned(?:\((?:safe|unsafe)\))?|mutating|nonmutating|nonisolated(?:\(unsafe\))?|distributed|borrowing|consuming|isolated|sending|prefix|infix|postfix)\b(?:\s*\(set\))?\s*/.exec(
        out,
      );
      if (modifier === null) return out;
      out = out.slice(modifier[0].length).trimStart();
    }
  }

  function normalizeTypePath(source: string): string {
    return source
      .split(".")
      .map((part) => unquote(part.trim()))
      .join(".");
  }

  function unquote(source: string): string {
    return source.startsWith("`") && source.endsWith("`")
      ? source.slice(1, -1)
      : source;
  }

  function delimitersAreBalanced(source: string): boolean {
    const stack: string[] = [];
    const closing = new Map([
      [")", "("],
      ["]", "["],
      [">", "<"],
    ]);
    for (let index = 0; index < source.length; index++) {
      const char = source[index]!;
      if (
        char === "(" ||
        char === "[" ||
        (char === "<" && isGenericOpen(source, index))
      )
        stack.push(char);
      else if (closing.has(char)) {
        if (stack.at(-1) === closing.get(char)) stack.pop();
      }
    }
    return stack.length === 0;
  }

  function hasTopLevelBodyStart(source: string): boolean {
    return firstTopLevelBodyStart(source) !== -1;
  }

  function firstTopLevelBodyStart(source: string): number {
    let parentheses = 0;
    let brackets = 0;
    let angles = 0;
    for (let index = 0; index < source.length; index++) {
      const char = source[index]!;
      if (char === "(") parentheses++;
      else if (char === ")") parentheses = Math.max(0, parentheses - 1);
      else if (char === "[") brackets++;
      else if (char === "]") brackets = Math.max(0, brackets - 1);
      else if (char === "<" && isGenericOpen(source, index)) angles++;
      else if (char === ">") angles = Math.max(0, angles - 1);
      else if (
        char === "{" &&
        parentheses === 0 &&
        brackets === 0 &&
        angles === 0
      )
        return index;
    }
    return -1;
  }

  function topLevelIndexOf(source: string, needle: string): number {
    let parentheses = 0;
    let brackets = 0;
    let angles = 0;
    for (let index = 0; index < source.length; index++) {
      const char = source[index]!;
      if (char === "(") parentheses++;
      else if (char === ")") parentheses = Math.max(0, parentheses - 1);
      else if (char === "[") brackets++;
      else if (char === "]") brackets = Math.max(0, brackets - 1);
      else if (char === "<" && isGenericOpen(source, index)) angles++;
      else if (char === ">") angles = Math.max(0, angles - 1);
      else if (
        char === needle &&
        parentheses === 0 &&
        brackets === 0 &&
        angles === 0
      )
        return index;
    }
    return -1;
  }

  function splitTopLevel(source: string, separator: string): string[] {
    const out: string[] = [];
    let start = 0;
    let parentheses = 0;
    let brackets = 0;
    let angles = 0;
    for (let index = 0; index < source.length; index++) {
      const char = source[index]!;
      if (char === "(") parentheses++;
      else if (char === ")") parentheses = Math.max(0, parentheses - 1);
      else if (char === "[") brackets++;
      else if (char === "]") brackets = Math.max(0, brackets - 1);
      else if (char === "<" && isGenericOpen(source, index)) angles++;
      else if (char === ">") angles = Math.max(0, angles - 1);
      else if (
        char === separator &&
        parentheses === 0 &&
        brackets === 0 &&
        angles === 0
      ) {
        out.push(source.slice(start, index));
        start = index + 1;
      }
    }
    out.push(source.slice(start));
    return out;
  }

  function isGenericOpen(source: string, index: number): boolean {
    if (index === 0 || /\s/.test(source[index - 1]!)) return false;
    let next = index + 1;
    while (next < source.length && /\s/.test(source[next]!)) next++;
    return /[A-Za-z_$`@[(]/.test(source[next] ?? "");
  }

  function matchingDelimiter(
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

  function nextCodeLine(
    lines: readonly string[],
    start: number,
  ): number | undefined {
    for (let index = start; index < lines.length; index++) {
      const text = lines[index]!.trim();
      if (text !== "" && !text.startsWith("//")) return index;
    }
    return undefined;
  }

  function lineCountBefore(source: string, end: number): number {
    let count = 0;
    for (let index = 0; index < end; index++) {
      if (source[index] === "\n") count++;
    }
    return count;
  }

  /** Offset-preserving Swift lexical masking for declaration boundaries. */
  function swiftLexicalText(source: string): string {
    const out = source.split("");
    const blank = (start: number, end: number): void => {
      for (let index = start; index < end; index++) {
        if (source[index] !== "\n" && source[index] !== "\r") out[index] = " ";
      }
    };
    for (let index = 0; index < source.length; ) {
      if (source.startsWith("//", index)) {
        const end = source.indexOf("\n", index);
        blank(index, end === -1 ? source.length : end);
        index = end === -1 ? source.length : end;
        continue;
      }
      if (source.startsWith("/*", index)) {
        const end = nestedBlockCommentEnd(source, index);
        blank(index, end);
        index = end;
        continue;
      }
      const raw = rawLiteralEnd(source, index);
      if (raw !== undefined) {
        blank(index, raw);
        index = raw;
        continue;
      }
      if (source.startsWith('"""', index)) {
        const end = endingAfter(source, index + 3, '"""');
        blank(index, end);
        index = end;
        continue;
      }
      if (source[index] === '"') {
        const end = quotedEnd(source, index);
        blank(index, end);
        index = end;
        continue;
      }
      if (source[index] === "/" && startsRegexLiteral(source, index)) {
        const end = regexEnd(source, index, "");
        blank(index, end);
        index = end;
        continue;
      }
      index++;
    }
    return out.join("");
  }

  function nestedBlockCommentEnd(source: string, start: number): number {
    let depth = 1;
    for (let index = start + 2; index < source.length; index++) {
      if (source.startsWith("/*", index)) {
        depth++;
        index++;
      } else if (source.startsWith("*/", index)) {
        depth--;
        if (depth === 0) return index + 2;
        index++;
      }
    }
    return source.length;
  }

  function rawLiteralEnd(source: string, start: number): number | undefined {
    if (source[start] !== "#") return undefined;
    const prefix = /^(#+)("""|"|\/)/.exec(source.slice(start));
    if (prefix === null) return undefined;
    const hashes = prefix[1]!;
    const opening = prefix[2]!;
    const closing = opening === "/" ? `/${hashes}` : `${opening}${hashes}`;
    return endingAfter(source, start + prefix[0].length, closing);
  }

  function quotedEnd(source: string, start: number): number {
    for (let index = start + 1; index < source.length; index++) {
      if (source[index] === "\\") index++;
      else if (source[index] === '"') return index + 1;
    }
    return source.length;
  }

  function startsRegexLiteral(source: string, start: number): boolean {
    let cursor = start - 1;
    while (cursor >= 0 && /\s/.test(source[cursor]!)) cursor--;
    return cursor < 0 || /[=([{,:;!&|?+*%~^<>-]/.test(source[cursor]!);
  }

  function regexEnd(source: string, start: number, hashes: string): number {
    let characterClass = false;
    for (let index = start + 1; index < source.length; index++) {
      const char = source[index]!;
      if (char === "\\") index++;
      else if (characterClass) {
        if (char === "]") characterClass = false;
      } else if (char === "[") characterClass = true;
      else if (char === "/" && source.startsWith(hashes, index + 1))
        return index + 1 + hashes.length;
    }
    return source.length;
  }

  function endingAfter(
    source: string,
    start: number,
    delimiter: string,
  ): number {
    const end = source.indexOf(delimiter, start);
    return end === -1 ? source.length : end + delimiter.length;
  }
}
