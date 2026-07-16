import { ISamchonGraphNode } from "../structures";
import { GraphNodeKind } from "../typings";

export namespace KotlinDeclarations {
  export interface IKotlinDeclaration {
    kind: GraphNodeKind;
    name: string;
    exported?: boolean;
    modifiers?: ISamchonGraphNode["modifiers"];
  }

  const TYPE_KINDS = new Set<GraphNodeKind>([
    "class",
    "enum",
    "interface",
    "type",
  ]);

  /**
   * Mask Kotlin comments and strings once per file while preserving every line
   * and column. Kotlin permits nested block comments and multiline raw strings;
   * a per-line regex would turn examples inside either into graph declarations.
   */
  export function kotlinLexicalLines(lines: readonly string[]): string[] {
    const out: string[] = [];
    let blockCommentDepth = 0;
    let rawString = false;
    for (const line of lines) {
      const chars = line.split("");
      let index = 0;
      const starts = (token: string): boolean => line.startsWith(token, index);
      const mask = (length: number): void => {
        for (let offset = 0; offset < length; offset++)
          chars[index + offset] = " ";
        index += length;
      };
      while (index < line.length) {
        if (blockCommentDepth > 0) {
          if (starts("/*")) {
            mask(2);
            blockCommentDepth++;
          } else if (starts("*/")) {
            mask(2);
            blockCommentDepth--;
          } else mask(1);
          continue;
        }
        if (rawString) {
          if (starts('\"\"\"')) {
            mask(3);
            rawString = false;
          } else mask(1);
          continue;
        }
        if (starts("//")) {
          mask(line.length - index);
          continue;
        }
        if (starts("/*")) {
          mask(2);
          blockCommentDepth = 1;
          continue;
        }
        if (starts('\"\"\"')) {
          mask(3);
          rawString = true;
          continue;
        }
        if (line[index] === '"' || line[index] === "'") {
          const quote = line[index]!;
          mask(1);
          while (index < line.length) {
            if (line[index] === "\\")
              mask(Math.min(2, line.length - index));
            else {
              const closed = line[index] === quote;
              mask(1);
              if (closed) break;
            }
          }
          continue;
        }
        index++;
      }
      out.push(chars.join(""));
    }
    return out;
  }

  /** Join a bounded Kotlin head split over type parameters or value parameters. */
  export function kotlinDeclarationHeader(
    lines: readonly string[],
    start: number,
  ): string {
    const first = lines[start]!.trim();
    if (
      first === "" ||
      first.startsWith("//") ||
      first.startsWith("/*") ||
      first.startsWith("*") ||
      first.startsWith("@")
    )
      return lines[start]!;

    const out: string[] = [];
    let angle = 0;
    let parentheses = 0;
    let brackets = 0;
    for (let index = start; index < Math.min(lines.length, start + 48); index++) {
      const raw = lines[index]!;
      const lexical = stripStringsAndComments(raw);
      out.push(raw.trim());
      let terminated = false;
      for (const char of lexical) {
        if (
          angle === 0 &&
          parentheses === 0 &&
          brackets === 0 &&
          (char === "{" || char === ";" || char === "=")
        ) {
          terminated = true;
          break;
        } else if (char === "<") angle++;
        else if (char === ">") angle = Math.max(0, angle - 1);
        else if (char === "(") parentheses++;
        else if (char === ")") parentheses = Math.max(0, parentheses - 1);
        else if (char === "[") brackets++;
        else if (char === "]") brackets = Math.max(0, brackets - 1);
      }
      if (
        terminated ||
        (angle === 0 &&
          parentheses === 0 &&
          brackets === 0 &&
          declarationHeadIsComplete(out.join(" ")))
      )
        break;
    }
    return out.join(" ");
  }

  /**
   * Bound Kotlin declarations without letting a bodyless interface method own
   * the next method's braces. Expression bodies and property accessors instead
   * extend only through their deeper-indented continuation.
   */
  export function kotlinDeclarationEndIndex(
    lines: readonly string[],
    start: number,
  ): number {
    const headerEnd = kotlinHeaderEndIndex(lines, start);
    const header = lines.slice(start, headerEnd + 1).join("\n");
    const next = nextCodeLine(lines, headerEnd + 1);
    if (
      hasTopLevelCharacter(header, "{") ||
      (next !== undefined &&
        leadingWhitespace(lines[next]!) === leadingWhitespace(lines[start]!) &&
        lines[next]!.trimStart().startsWith("{"))
    )
      return braceEndIndex(lines, start);

    const clean = eraseLeadingAnnotations(stripStringsAndComments(header).trim());
    const declaration = stripModifiers(clean);
    if (
      declaration.startsWith("fun ") ||
      /^constructor\s*\(/.test(declaration) ||
      /^(?:const\s+)?(?:lateinit\s+)?(?:val|var)\s+/.test(declaration)
    ) {
      return indentedContinuationEnd(lines, start, headerEnd);
    }
    return headerEnd;
  }

  /** Parse Kotlin declarations without mistaking generic or extension syntax for names. */
  export function parseKotlinDeclaration(
    source: string,
    ownerName?: string,
    ownerKind?: GraphNodeKind,
  ): IKotlinDeclaration | undefined {
    const clean = eraseLeadingAnnotations(stripStringsAndComments(source).trim());
    if (clean === "") return undefined;
    const declaration = stripModifiers(clean);

    const companion =
      /^object(?:\s+(`[^`]+`|[A-Za-z_$][\w$]*))?(?=\s|[:{]|$)/.exec(
        declaration,
      );
    if (companion !== null && /\bcompanion\b/.test(clean)) {
      const modifiers = kotlinGraphModifiersOf(clean, "class", ownerKind);
      return {
        kind: "class",
        name: companion[1] === undefined ? "Companion" : unquote(companion[1]),
        ...(modifiers.length > 0 ? { modifiers } : {}),
      };
    }

    const type =
      /^(?:(enum|annotation)\s+class|fun\s+interface|(?:data|sealed|value|inline)\s+class|sealed\s+interface|class|interface|object|typealias)\s+(`[^`]+`|[A-Za-z_$][\w$]*)(?=\s|[<(:={]|$)/.exec(
        declaration,
      );
    if (type !== null) {
      const token = type[0]!.slice(0, type[0]!.lastIndexOf(type[2]!)).trim();
      const kind: GraphNodeKind =
        token.startsWith("enum class")
          ? "enum"
          : token.includes("interface")
            ? "interface"
            : token.startsWith("typealias")
              ? "type"
              : "class";
      const modifiers = kotlinGraphModifiersOf(clean, kind, ownerKind);
      return {
        kind,
        name: unquote(type[2]!),
        ...(isKotlinPublishedDeclaration(kind, ownerKind, modifiers)
          ? { exported: true }
          : {}),
        ...(modifiers.length > 0 ? { modifiers } : {}),
      };
    }

    if (declaration.startsWith("fun ")) {
      const name = kotlinFunctionName(declaration);
      if (name === undefined) return undefined;
      const kind: GraphNodeKind = isTypeOwner(ownerKind) ? "method" : "function";
      const modifiers = kotlinGraphModifiersOf(clean, kind, ownerKind);
      return {
        kind,
        name,
        ...(isKotlinPublishedDeclaration(kind, ownerKind, modifiers)
          ? { exported: true }
          : {}),
        ...(modifiers.length > 0 ? { modifiers } : {}),
      };
    }

    if (isTypeOwner(ownerKind) && /^constructor\s*\(/.test(declaration)) {
      const modifiers = kotlinGraphModifiersOf(clean, "constructor", ownerKind);
      return {
        kind: "constructor",
        name: ownerName?.slice(ownerName.lastIndexOf(".") + 1) ?? "constructor",
        ...(modifiers.length > 0 ? { modifiers } : {}),
      };
    }

    const property = kotlinPropertyName(declaration);
    if (property !== undefined) {
      const kind: GraphNodeKind = isTypeOwner(ownerKind) ? "property" : "variable";
      const modifiers = kotlinGraphModifiersOf(clean, kind, ownerKind);
      return {
        kind,
        name: property,
        ...(isKotlinPublishedDeclaration(kind, ownerKind, modifiers)
          ? { exported: true }
          : {}),
        ...(modifiers.length > 0 ? { modifiers } : {}),
      };
    }
    return undefined;
  }

  /** Recover Kotlin visibility and the graph modifiers Kotlin spells directly. */
  export function kotlinGraphModifiersOf(
    source: string,
    kind?: GraphNodeKind,
    ownerKind?: GraphNodeKind,
  ): NonNullable<ISamchonGraphNode["modifiers"]> {
    // Visibility belongs before the declaration keyword. Scanning the whole
    // header makes `class Scope internal constructor(...)` look like an
    // internal class even though only its primary constructor is internal.
    const clean = kotlinModifierPrefix(source);
    const out: NonNullable<ISamchonGraphNode["modifiers"]> = [];
    for (const match of clean.matchAll(
      /\b(public|private|protected|internal|abstract|const)\b/g,
    )) {
      const modifier = match[1] as NonNullable<
        ISamchonGraphNode["modifiers"]
      >[number];
      if (!out.includes(modifier)) out.push(modifier);
    }
    if (
      !hasVisibility(out) &&
      kind !== undefined &&
      ownerKind !== "function" &&
      ownerKind !== "method" &&
      ownerKind !== "constructor"
    )
      out.unshift("public");
    return out;
  }

  export function isKotlinPublishedDeclaration(
    kind: GraphNodeKind,
    ownerKind: GraphNodeKind | undefined,
    modifiers: readonly string[] | undefined,
  ): boolean {
    return (
      ownerKind === undefined &&
      (TYPE_KINDS.has(kind) || kind === "function" || kind === "variable") &&
      modifiers?.includes("public") === true
    );
  }

  function kotlinFunctionName(source: string): string | undefined {
    let rest = source.slice("fun".length).trimStart();
    if (rest.startsWith("<")) {
      const close = matchingAngleEnd(rest, 0);
      if (close === -1) return undefined;
      rest = rest.slice(close + 1).trimStart();
    }
    const open = topLevelParenthesis(rest);
    if (open === -1) return undefined;
    const before = rest.slice(0, open).trimEnd();
    const name = /(`[^`]+`|[A-Za-z_$][\w$]*)$/.exec(before)?.[1];
    return name === undefined ? undefined : unquote(name);
  }

  function kotlinPropertyName(source: string): string | undefined {
    const prefix = /^(?:const\s+)?(?:lateinit\s+)?(?:val|var)\s+/.exec(source);
    if (prefix === null) return undefined;
    let rest = source.slice(prefix[0].length).trimStart();
    if (rest.startsWith("<")) {
      const close = matchingAngleEnd(rest, 0);
      if (close === -1) return undefined;
      rest = rest.slice(close + 1).trimStart();
    }
    let angle = 0;
    let parentheses = 0;
    let brackets = 0;
    let end = rest.length;
    for (let index = 0; index < rest.length; index++) {
      const char = rest[index]!;
      if (char === "<") angle++;
      else if (char === ">") angle = Math.max(0, angle - 1);
      else if (char === "(") parentheses++;
      else if (char === ")") parentheses = Math.max(0, parentheses - 1);
      else if (char === "[") brackets++;
      else if (char === "]") brackets = Math.max(0, brackets - 1);
      else if (
        angle === 0 &&
        parentheses === 0 &&
        brackets === 0 &&
        (char === ":" ||
          char === "=" ||
          (/\s/.test(char) && /^(?:by|get|set)\b/.test(rest.slice(index).trimStart())))
      ) {
        end = index;
        break;
      }
    }
    const name = /(`[^`]+`|[A-Za-z_$][\w$]*)$/.exec(
      rest.slice(0, end).trimEnd(),
    )?.[1];
    return name === undefined ? undefined : unquote(name);
  }

  function matchingAngleEnd(source: string, start: number): number {
    let depth = 0;
    for (let index = start; index < source.length; index++) {
      if (source[index] === "<") depth++;
      else if (source[index] === ">" && --depth === 0) return index;
    }
    return -1;
  }

  function topLevelParenthesis(source: string): number {
    let angle = 0;
    let parentheses = 0;
    let candidate = -1;
    for (let index = 0; index < source.length; index++) {
      if (source[index] === "<") angle++;
      else if (source[index] === ">") angle = Math.max(0, angle - 1);
      else if (source[index] === "(" && angle === 0) {
        if (parentheses === 0) candidate = index;
        parentheses++;
      } else if (source[index] === ")") {
        parentheses = Math.max(0, parentheses - 1);
      } else if (
        (source[index] === "=" || source[index] === "{") &&
        angle === 0 &&
        parentheses === 0
      )
        break;
    }
    return candidate;
  }

  function declarationHeadIsComplete(source: string): boolean {
    const clean = eraseLeadingAnnotations(stripStringsAndComments(source).trim());
    const declaration = stripModifiers(clean);
    if (/^(?:const\s+)?(?:lateinit\s+)?(?:val|var)\s+/.test(declaration))
      return true;
    if (/^typealias\s+/.test(declaration)) return declaration.includes("=");
    if (/^fun\s+/.test(declaration)) {
      const open = topLevelParenthesis(
        declaration.slice("fun".length).trimStart(),
      );
      return open !== -1 && /\)\s*(?::\s*[^=]+)?\s*$/.test(declaration);
    }
    return (
      /^(?:(?:enum|annotation)\s+class|fun\s+interface|(?:data|sealed|value|inline)\s+class|sealed\s+interface|class|interface|object)\s+/.test(
        declaration,
      ) && !/[,:]\s*$/.test(declaration)
    );
  }

  function kotlinHeaderEndIndex(
    lines: readonly string[],
    start: number,
  ): number {
    let angle = 0;
    let parentheses = 0;
    let brackets = 0;
    for (let index = start; index < Math.min(lines.length, start + 48); index++) {
      const lexical = stripStringsAndComments(lines[index]!);
      let terminated = false;
      for (const char of lexical) {
        if (
          angle === 0 &&
          parentheses === 0 &&
          brackets === 0 &&
          (char === "{" || char === ";" || char === "=")
        ) {
          terminated = true;
          break;
        } else if (char === "<") angle++;
        else if (char === ">") angle = Math.max(0, angle - 1);
        else if (char === "(") parentheses++;
        else if (char === ")") parentheses = Math.max(0, parentheses - 1);
        else if (char === "[") brackets++;
        else if (char === "]") brackets = Math.max(0, brackets - 1);
      }
      if (
        terminated ||
        (angle === 0 &&
          parentheses === 0 &&
          brackets === 0 &&
          declarationHeadIsComplete(lines.slice(start, index + 1).join(" ")))
      )
        return index;
    }
    return start;
  }

  function braceEndIndex(lines: readonly string[], start: number): number {
    let depth = 0;
    let entered = false;
    for (let index = start; index < lines.length; index++) {
      const lexical = stripStringsAndComments(lines[index]!);
      for (const char of lexical) {
        if (char === "{") {
          depth++;
          entered = true;
        } else if (char === "}") depth = Math.max(0, depth - 1);
      }
      if (entered && depth === 0) return index;
    }
    return kotlinHeaderEndIndex(lines, start);
  }

  function indentedContinuationEnd(
    lines: readonly string[],
    start: number,
    headerEnd: number,
  ): number {
    const indentation = leadingWhitespace(lines[start]!);
    let end = headerEnd;
    for (let index = headerEnd + 1; index < lines.length; index++) {
      const line = lines[index]!;
      if (line.trim() === "") {
        end = index;
        continue;
      }
      if (leadingWhitespace(line) <= indentation) break;
      end = index;
    }
    while (end > headerEnd && lines[end]!.trim() === "") end--;
    return end;
  }

  function leadingWhitespace(source: string): number {
    return /^\s*/.exec(source)?.[0].length ?? 0;
  }

  function nextCodeLine(
    lines: readonly string[],
    start: number,
  ): number | undefined {
    for (let index = start; index < lines.length; index++)
      if (lines[index]!.trim() !== "") return index;
    return undefined;
  }

  function hasTopLevelCharacter(source: string, target: string): boolean {
    let angle = 0;
    let parentheses = 0;
    let brackets = 0;
    for (const char of stripStringsAndComments(source)) {
      if (char === "<") angle++;
      else if (char === ">") angle = Math.max(0, angle - 1);
      else if (char === "(") parentheses++;
      else if (char === ")") parentheses = Math.max(0, parentheses - 1);
      else if (char === "[") brackets++;
      else if (char === "]") brackets = Math.max(0, brackets - 1);
      else if (
        char === target &&
        angle === 0 &&
        parentheses === 0 &&
        brackets === 0
      )
        return true;
    }
    return false;
  }

  function stripModifiers(source: string): string {
    let out = source;
    for (;;) {
      const modifier =
        /^(?:public|private|protected|internal|expect|actual|final|open|abstract|sealed|const|external|override|lateinit|tailrec|vararg|suspend|inner|companion|inline|value|infix|operator|data)\b\s*/.exec(
          out,
        );
      if (modifier === null) return out;
      out = out.slice(modifier[0].length).trimStart();
    }
  }

  function eraseLeadingAnnotations(source: string): string {
    let out = source;
    while (out.startsWith("@")) {
      let index = 1;
      if (out[index] === "[") {
        index = matchingDelimiterEnd(out, index, "[", "]");
      } else {
        while (index < out.length && /[\w$.:]/.test(out[index]!)) index++;
        if (index === 1) return out;
        while (index < out.length && /\s/.test(out[index]!)) index++;
        if (out[index] === "(")
          index = matchingDelimiterEnd(out, index, "(", ")");
      }
      if (index === -1) return "";
      out = out.slice(index).trimStart();
    }
    return out;
  }

  function matchingDelimiterEnd(
    source: string,
    start: number,
    open: string,
    close: string,
  ): number {
    let depth = 0;
    let quote: string | undefined;
    for (let index = start; index < source.length; index++) {
      const char = source[index]!;
      if (quote !== undefined) {
        if (char === "\\") index++;
        else if (char === quote) quote = undefined;
      } else if (char === '"' || char === "'") quote = char;
      else if (char === open) depth++;
      else if (char === close && --depth === 0) return index + 1;
    }
    return -1;
  }

  function hasVisibility(modifiers: readonly string[]): boolean {
    return modifiers.some(
      (modifier) =>
        modifier === "public" ||
        modifier === "private" ||
        modifier === "protected" ||
        modifier === "internal",
    );
  }

  function kotlinModifierPrefix(source: string): string {
    const clean = eraseLeadingAnnotations(
      stripStringsAndComments(source).trim(),
    );
    const declaration =
      /\b(?:class|interface|object|typealias|fun|constructor|val|var)\b/.exec(
        clean,
      );
    return declaration === null ? clean : clean.slice(0, declaration.index);
  }

  function isTypeOwner(kind: GraphNodeKind | undefined): boolean {
    return kind === "class" || kind === "enum" || kind === "interface";
  }

  function unquote(name: string): string {
    return name.startsWith("`") ? name.slice(1, -1) : name;
  }

  function stripStringsAndComments(source: string): string {
    return kotlinLexicalLines(source.split("\n")).join("\n");
  }
}
