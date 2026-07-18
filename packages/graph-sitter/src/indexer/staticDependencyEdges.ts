import {
  ISamchonGraphEdge,
  ISamchonGraphEvidence,
  ISamchonGraphNode,
} from "../structures";
import { GraphEdgeKind, GraphLanguage, GraphNodeKind } from "../typings";

const IDENTIFIER = /[A-Za-z_$][A-Za-z0-9_$]*/g;

/**
 * Derive conservative static dependency facts from one declaration body.
 *
 * Textual occurrence is not enough evidence when several declarations share a
 * name. Resolution uses, in order, an explicit receiver/qualifier, the source's
 * lexical owner, or a sole same-file/project top-level declaration. An
 * unresolved tie emits no edge; filesystem order is never semantic evidence.
 */
export function staticDependencyEdges(
  source: ISamchonGraphNode,
  body: string,
  byName: ReadonlyMap<string, readonly ISamchonGraphNode[]>,
): ISamchonGraphEdge[] {
  const lexical = maskLexicalRegions(source.language, body);
  const relations = new Map<
    string,
    {
      target: ISamchonGraphNode;
      kind: GraphEdgeKind;
      evidence: ISamchonGraphEvidence;
    }
  >();
  let currentLine = source.evidence?.startLine ?? 1;
  let lineStart = 0;
  let locationCursor = 0;
  IDENTIFIER.lastIndex = 0;
  for (
    let match = IDENTIFIER.exec(lexical);
    match !== null;
    match = IDENTIFIER.exec(lexical)
  ) {
    for (;;) {
      const newline = lexical.indexOf("\n", locationCursor);
      if (newline < 0 || newline >= match.index) break;
      currentLine++;
      lineStart = newline + 1;
      locationCursor = newline + 1;
    }
    let name = match[0];
    let cursor = match.index + name.length;
    const rubySuffix = lexical[cursor];
    if (
      source.language === "ruby" &&
      (rubySuffix === "!" || rubySuffix === "?")
    ) {
      name += rubySuffix;
      cursor++;
    }
    if (name === source.name) continue;
    const candidates = byName.get(name);
    if (candidates === undefined) continue;
    const target = resolveOccurrence(
      source,
      lexical,
      match.index,
      candidates,
    );
    if (target === undefined) continue;

    // Whitespace and a masked comment may separate a callable from `(`. The
    // occurrence itself remains the evidence span even for a multiline call.
    while (cursor < lexical.length && /\s/.test(lexical[cursor]!)) cursor++;
    const isCall =
      lexical[cursor] === "(" ||
      (source.language === "ruby" &&
        (name.endsWith("!") || name.endsWith("?")));
    const kind: GraphEdgeKind = isCall
      ? target.kind === "class"
        ? "instantiates"
        : "calls"
      : isHandOff(lexical, match.index, cursor, target)
        ? "accesses"
        : "type_ref";
    const startCol = match.index - lineStart + 1;
    const evidence: ISamchonGraphEvidence = {
      file: source.file,
      startLine: currentLine,
      startCol,
      endLine: currentLine,
      endCol: startCol + name.length,
    };
    // @ttsc/graph identifies an edge by (from, to, wire kind). A declaration
    // may name the same target in a type position, invoke it directly, and hand
    // it to another call; those are three distinct facts. Repeated occurrences
    // of the same relation still keep their first source-order evidence.
    const key = `${target.id}\0${kind}`;
    if (!relations.has(key)) relations.set(key, { target, kind, evidence });
  }
  return [...relations.values()].map(({ target, kind, evidence }) => ({
    from: source.id,
    to: target.id,
    kind,
    evidence,
  }));
}

interface IQualifier {
  present: boolean;
  names: string[];
}

function resolveOccurrence(
  source: ISamchonGraphNode,
  body: string,
  occurrence: number,
  input: readonly ISamchonGraphNode[],
): ISamchonGraphNode | undefined {
  let candidates = uniqueNodes(
    input.filter((candidate) => candidate.id !== source.id),
  );
  if (candidates.length === 0) return undefined;

  // A static source language cannot prove a normal cross-language call.
  candidates = candidates.filter(
    (candidate) => candidate.language === source.language,
  );
  if (candidates.length === 0) return undefined;

  const qualifier = qualifierBefore(body, occurrence, source.language);
  const sourceOwner = lexicalOwnerOf(source);
  if (qualifier.present) {
    if (qualifier.names.length === 0) return undefined;
    const receiver = qualifier.names.join(".");
    const last = qualifier.names.at(-1)!;
    if (isSelfReceiver(source.language, last)) {
      if (sourceOwner === undefined) return undefined;
      return chooseLocal(
        source,
        candidates.filter((candidate) => ownerOf(candidate) === sourceOwner),
      );
    }
    if (isAncestorReceiver(source.language, last)) {
      // The fallback does not retain a proven base-member dispatch table. A
      // same-name member on another owner is not evidence that it is inherited.
      return undefined;
    }
    const qualified = candidates.filter((candidate) =>
      ownerKeysOf(candidate).some(
        (owner) => owner === receiver || owner?.endsWith(`.${receiver}`) === true,
      ),
    );
    if (qualified.length > 0) return chooseLocal(source, qualified);
    // A lower-case/object receiver carries no usable static type. Project-wide
    // uniqueness of the member name does not prove that receiver's class.
    return undefined;
  }

  if (sourceOwner !== undefined) {
    for (const scope of enclosingScopes(sourceOwner)) {
      const sameScope = candidates.filter((candidate) =>
        ownerKeysOf(candidate).includes(scope),
      );
      if (sameScope.length === 0) continue;
      // An ambiguity in the nearest lexical scope must not fall through to a
      // coincidentally unique declaration in an outer scope.
      return chooseLocal(source, sameScope);
    }
  }
  // A bare name can reach a top-level declaration. An owned member requires a
  // matching lexical owner above; otherwise `run()` in A (or module scope) must
  // not become B.run merely because B is the only declaration in the project.
  return chooseLocal(
    source,
    candidates.filter((candidate) => ownerKeysOf(candidate).includes(undefined)),
  );
}

function enclosingScopes(owner: string): string[] {
  const parts = owner.split(".");
  return parts.map((_, index) => parts.slice(0, parts.length - index).join("."));
}

function chooseLocal(
  source: ISamchonGraphNode,
  candidates: readonly ISamchonGraphNode[],
): ISamchonGraphNode | undefined {
  const sameFile = candidates.filter(
    (candidate) => candidate.file === source.file,
  );
  return sole(sameFile) ?? sole(candidates);
}

function sole(
  candidates: readonly ISamchonGraphNode[],
): ISamchonGraphNode | undefined {
  return candidates.length === 1 ? candidates[0] : undefined;
}

function uniqueNodes(
  candidates: readonly ISamchonGraphNode[],
): ISamchonGraphNode[] {
  return [
    ...new Map(
      candidates.map((candidate) => [candidate.id, candidate]),
    ).values(),
  ];
}

function lexicalOwnerOf(node: ISamchonGraphNode): string | undefined {
  const qualified = node.qualifiedName;
  if (isOwnerKind(node.kind)) return qualified ?? node.name;
  if (qualified === undefined) return undefined;
  const boundary = qualified.lastIndexOf(".");
  return boundary === -1 ? undefined : qualified.slice(0, boundary);
}

function ownerOf(node: ISamchonGraphNode): string | undefined {
  const qualified = node.qualifiedName;
  if (qualified === undefined) return undefined;
  const suffix = `.${node.name}`;
  if (qualified.endsWith(suffix)) return qualified.slice(0, -suffix.length);
  const boundary = qualified.lastIndexOf(".");
  return boundary === -1 ? undefined : qualified.slice(0, boundary);
}

// C++ gives an anonymous namespace no name a caller can write, and its members
// are visible throughout the enclosing namespace for the whole translation unit.
// So such a declaration answers to the scope *outside* it as well as its own,
// and a resolver that only compares the literal owner never finds it from there.
// `staticGraphParts` already elides these segments when it keys owners; this is
// the same rule on the reading side.
const ANONYMOUS_NAMESPACE = "(anonymous namespace)";

function ownerKeysOf(
  node: ISamchonGraphNode,
): readonly (string | undefined)[] {
  const owner = ownerOf(node);
  if (owner === undefined) return [undefined];
  if (node.language !== "cpp" && node.language !== "c") return [owner];
  const parts = owner.split(".");
  if (!parts.includes(ANONYMOUS_NAMESPACE)) return [owner];
  const alias = parts.filter((name) => name !== ANONYMOUS_NAMESPACE).join(".");
  // An anonymous namespace at file scope elides to nothing, which is the
  // top-level key — the same one a free function answers to.
  return [owner, alias === "" ? undefined : alias];
}

function isOwnerKind(kind: GraphNodeKind): boolean {
  return (
    kind === "class" ||
    kind === "interface" ||
    kind === "enum" ||
    kind === "namespace" ||
    kind === "module"
  );
}

function qualifierBefore(
  body: string,
  occurrence: number,
  language: GraphLanguage,
): IQualifier {
  let cursor = skipWhitespaceBackward(body, occurrence - 1);
  const names: string[] = [];
  let present = false;
  for (;;) {
    const separator = receiverSeparatorBefore(body, cursor, language);
    if (separator === undefined) break;
    present = true;
    cursor = skipWhitespaceBackward(body, separator - 1);
    const end = cursor + 1;
    while (cursor >= 0 && /[A-Za-z0-9_$]/.test(body[cursor]!)) cursor--;
    const name = body.slice(cursor + 1, end).replace(/^\$/, "");
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
      return { present: true, names: [] };
    }
    names.unshift(name);
    cursor = skipWhitespaceBackward(body, cursor);
  }
  return { present, names };
}

function receiverSeparatorBefore(
  body: string,
  cursor: number,
  language: GraphLanguage,
): number | undefined {
  if (cursor < 0) return undefined;
  if (body[cursor] === "." || body[cursor] === ":") {
    if (cursor > 0 && body[cursor - 1] === body[cursor]) return cursor - 1;
    if (
      body[cursor] === "." &&
      cursor > 0 &&
      (body[cursor - 1] === "?" || body[cursor - 1] === "&")
    )
      return cursor - 1;
    // A lone `:` reaches a member only in Lua, which spells a method call
    // `obj:method()`. Everywhere else it opens a type annotation, and reading
    // `value: Model` as a receiver makes `Model` a member of `value` — a
    // lower-case receiver carries no static type, so the occurrence resolves to
    // nothing and the annotation loses the very `type_ref` it exists to state.
    // The doubled `::` that C++, PHP, Ruby, and Rust use is already taken above.
    if (body[cursor] === ":" && language !== "lua") return undefined;
    return cursor;
  }
  if (body[cursor] === ">" && cursor > 0 && body[cursor - 1] === "-") {
    return cursor - 1;
  }
  return undefined;
}

function skipWhitespaceBackward(body: string, start: number): number {
  let cursor = start;
  while (cursor >= 0 && /\s/.test(body[cursor]!)) cursor--;
  return cursor;
}

// A callable passed as an argument is a value access, not a direct invocation.
function isHandOff(
  body: string,
  start: number,
  afterName: number,
  target: ISamchonGraphNode,
): boolean {
  if (target.kind !== "function" && target.kind !== "method") return false;
  const before = skipWhitespaceBackward(body, start - 1);
  const opens = body[before] === "(" || body[before] === ",";
  const closes = body[afterName] === ")" || body[afterName] === ",";
  return opens && closes;
}

function isSelfReceiver(language: GraphLanguage, receiver: string): boolean {
  if (receiver === "this") {
    return THIS_LANGUAGES.has(language);
  }
  if (receiver === "self") {
    return (
      language === "rust" ||
      language === "python" ||
      language === "ruby" ||
      language === "swift" ||
      language === "php" ||
      language === "lua"
    );
  }
  if (receiver === "static") return language === "php";
  return receiver === "Self" && (language === "rust" || language === "swift");
}

function isAncestorReceiver(
  language: GraphLanguage,
  receiver: string,
): boolean {
  if (receiver === "base") return language === "csharp";
  return (
    receiver === "super" &&
    (language === "typescript" ||
      language === "java" ||
      language === "kotlin" ||
      language === "swift" ||
      language === "scala" ||
      language === "python" ||
      language === "ruby" ||
      language === "dart")
  );
}

/**
 * Blank comments and literals without changing UTF-16 offsets or line breaks.
 * Interpolated/template bodies are deliberately blanked as a whole: without a
 * real lexer, losing a possible call is safer than manufacturing one from data.
 */
function maskLexicalRegions(language: GraphLanguage, source: string): string {
  const output = source.split("");
  const blank = (start: number, end: number): void => {
    for (let index = start; index < end; index++) {
      if (source[index] !== "\n" && source[index] !== "\r") output[index] = " ";
    }
  };

  for (let index = 0; index < source.length; ) {
    if (startsRubyDataSection(source, index, language)) {
      blank(index, source.length);
      break;
    }
    if (startsZigMultilineString(source, index, language)) {
      const end = lineEnd(source, index);
      blank(index, end);
      index = end;
      continue;
    }
    const heredoc = heredocEnd(source, index, language);
    if (heredoc !== undefined) {
      blank(index, heredoc);
      index = heredoc;
      continue;
    }
    const luaLong = luaLongEnd(source, index, language);
    if (luaLong !== undefined) {
      blank(index, luaLong);
      index = luaLong;
      continue;
    }
    if (startsRubyBlockComment(source, index, language)) {
      const end = rubyBlockCommentEnd(source, index);
      blank(index, end);
      index = end;
      continue;
    }
    if (hasSlashComments(language) && source.startsWith("//", index)) {
      const end = lineEnd(source, index);
      blank(index, end);
      index = end;
      continue;
    }
    if (hasBlockComments(language) && source.startsWith("/*", index)) {
      const end = blockCommentEnd(source, index);
      blank(index, end);
      index = end;
      continue;
    }
    if (hasHashComments(language) && source[index] === "#") {
      if (!(language === "php" && source[index + 1] === "[")) {
        const end = lineEnd(source, index);
        blank(index, end);
        index = end;
        continue;
      }
    }
    if (language === "lua" && source.startsWith("--", index)) {
      const end = lineEnd(source, index);
      blank(index, end);
      index = end;
      continue;
    }

    const special = specialLiteralEnd(source, index, language);
    if (special !== undefined) {
      blank(index, special);
      index = special;
      continue;
    }
    const quote = source[index];
    if (
      quote === '"' ||
      quote === "`" ||
      (quote === "'" && startsSingleQuotedLiteral(source, index, language))
    ) {
      const end = quotedEnd(source, index, quote, false);
      blank(index, end);
      index = end;
      continue;
    }
    if (
      (language === "ruby" ||
        language === "typescript" ||
        language === "swift") &&
      source[index] === "/" &&
      startsSlashLiteral(source, index, language)
    ) {
      const end = slashLiteralEnd(source, index)!;
      blank(index, end);
      index = end;
      continue;
    }
    index++;
  }
  return output.join("");
}

function specialLiteralEnd(
  source: string,
  start: number,
  language: GraphLanguage,
): number | undefined {
  const first = source[start];
  const rust =
    language === "rust" &&
    (first === "b" || first === "c" || first === "r")
      ? /^(?:br|cr|r)(#*)"/.exec(source.slice(start, start + 260))
      : null;
  if (rust !== null && rust[1]!.length <= 255) {
    return endingAfter(source, start + rust[0].length, `"${rust[1]!}`);
  }
  if (language === "rust" && (first === "b" || first === "c")) {
    const prefixed = /^[bc](["'])/.exec(source.slice(start, start + 2));
    if (prefixed !== null) {
      return quotedEnd(source, start + 1, prefixed[1]!, false);
    }
  }

  const cpp =
    (language === "cpp" || language === "c") &&
    (first === "L" || first === "R" || first === "U" || first === "u")
      ? /^(?:u8|u|U|L)?R"([^ ()\\\t\r\n]{0,16})\(/.exec(
          source.slice(start, start + 24),
        )
      : null;
  if (cpp !== null) {
    return endingAfter(source, start + cpp[0].length, `)${cpp[1]!}"`);
  }
  if (
    (language === "cpp" || language === "c") &&
    (first === "L" || first === "U" || first === "u")
  ) {
    const prefixed = /^(?:u8|u|U|L)(["'])/.exec(
      source.slice(start, start + 3),
    );
    if (prefixed !== null) {
      const quoteStart = start + prefixed[0].length - 1;
      return quotedEnd(source, quoteStart, prefixed[1]!, false);
    }
  }

  if (
    language === "csharp" &&
    (first === "@" || first === "$" || first === '"')
  ) {
    const prefix = source.slice(start, start + 260);
    const verbatim = /^(?:\$@|@\$|@)"/.exec(prefix);
    if (verbatim !== null)
      return quotedEnd(source, start + verbatim[0].length - 1, '"', true);
    const raw = /^\$*"{3,}/.exec(prefix);
    if (raw !== null) {
      const delimiter = /"+$/.exec(raw[0])![0];
      return endingAfter(source, start + raw[0].length, delimiter);
    }
  }

  if (language === "swift" && source[start] === "#") {
    const prefix = source.slice(start, start + 260);
    const raw = /^(#+)("{1,3})/.exec(prefix);
    if (raw !== null) {
      return endingAfter(
        source,
        start + raw[0].length,
        `${raw[2]!}${raw[1]!}`,
      );
    }
    const regex = /^(#+)\//.exec(prefix);
    if (regex !== null) {
      return endingAfter(
        source,
        start + regex[0].length,
        `/${regex[1]!}`,
      );
    }
  }

  if (
    (language === "python" || language === "dart") &&
    (first === '"' ||
      first === "'" ||
      first === "b" ||
      first === "B" ||
      first === "f" ||
      first === "F" ||
      first === "r" ||
      first === "R" ||
      first === "u" ||
      first === "U")
  ) {
    const prefixes =
      language === "python"
        ? /^(?:[rRuUbBfF]{1,3})?("""|'''|"|')/.exec(
            source.slice(start, start + 7),
          )
        : /^(?:[rR])?("""|'''|"|')/.exec(
            source.slice(start, start + 5),
          );
    if (
      prefixes !== null &&
      (start === 0 || !/[A-Za-z0-9_$]/.test(source[start - 1]!))
    ) {
      const delimiter = prefixes[1]!;
      const quoteStart = start + prefixes[0].length - delimiter.length;
      return delimiter.length === 3
        ? endingAfter(source, quoteStart + 3, delimiter)
        : quotedEnd(source, quoteStart, delimiter, false);
    }
  }

  if (
    language === "scala" &&
    (first === "f" || first === "r" || first === "s")
  ) {
    const prefixed = /^(?:s|f|raw)("""|")/.exec(
      source.slice(start, start + 7),
    );
    if (prefixed !== null) {
      const delimiter = prefixed[1]!;
      const quoteStart = start + prefixed[0].length - delimiter.length;
      return delimiter.length === 3
        ? endingAfter(source, quoteStart + 3, delimiter)
        : quotedEnd(source, quoteStart, '"', false);
    }
  }

  if (language === "ruby" && source[start] === "%") {
    return rubyPercentLiteralEnd(source, start);
  }
  if (source.startsWith('"""', start) || source.startsWith("'''", start)) {
    const delimiter = source.slice(start, start + 3);
    return endingAfter(source, start + 3, delimiter);
  }
  return undefined;
}

function startsSingleQuotedLiteral(
  source: string,
  start: number,
  language: GraphLanguage,
): boolean {
  if (language !== "rust") return true;
  // Rust lifetimes (`'a`) have no closing quote. Character literals do; require
  // one on the same line so a lifetime cannot blank the rest of the function.
  for (
    let index = start + 1;
    index < source.length && source[index] !== "\n";
    index++
  ) {
    if (source[index] === "\\") index++;
    else if (source[index] === "'") return true;
  }
  return false;
}

function quotedEnd(
  source: string,
  start: number,
  delimiter: string,
  doubledDelimiter: boolean,
): number {
  for (let index = start + delimiter.length; index < source.length; index++) {
    if (!doubledDelimiter && source[index] === "\\") {
      index++;
      continue;
    }
    if (!source.startsWith(delimiter, index)) continue;
    if (
      doubledDelimiter &&
      source.startsWith(delimiter, index + delimiter.length)
    ) {
      index += delimiter.length;
      continue;
    }
    return index + delimiter.length;
  }
  return source.length;
}

function endingAfter(
  source: string,
  searchFrom: number,
  delimiter: string,
): number {
  const end = source.indexOf(delimiter, searchFrom);
  return end === -1 ? source.length : end + delimiter.length;
}

function lineEnd(source: string, start: number): number {
  const end = source.indexOf("\n", start);
  return end === -1 ? source.length : end;
}

function blockCommentEnd(source: string, start: number): number {
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

function startsRubyBlockComment(
  source: string,
  start: number,
  language: GraphLanguage,
): boolean {
  if (language !== "ruby" || !source.startsWith("=begin", start)) return false;
  return (
    (start === 0 || source[start - 1] === "\n") &&
    /\s/.test(source[start + 6] ?? "\n")
  );
}

function startsRubyDataSection(
  source: string,
  start: number,
  language: GraphLanguage,
): boolean {
  return (
    language === "ruby" &&
    (start === 0 || source[start - 1] === "\n") &&
    source.startsWith("__END__", start) &&
    /\s/.test(source[start + 7] ?? "\n")
  );
}

function startsZigMultilineString(
  source: string,
  start: number,
  language: GraphLanguage,
): boolean {
  if (language !== "zig" || !source.startsWith("\\\\", start)) return false;
  const lineStart = source.lastIndexOf("\n", start - 1) + 1;
  return source.slice(lineStart, start).trim() === "";
}

function rubyBlockCommentEnd(source: string, start: number): number {
  let cursor = lineEnd(source, start);
  while (cursor < source.length) {
    const next = cursor + 1;
    if (source.startsWith("=end", next) && /\s/.test(source[next + 4] ?? "\n")) {
      return lineEnd(source, next);
    }
    cursor = lineEnd(source, next);
  }
  return source.length;
}

function heredocEnd(
  source: string,
  start: number,
  language: GraphLanguage,
): number | undefined {
  if (language !== "php" && language !== "ruby") return undefined;
  if (source[start] !== "<" || source[start + 1] !== "<") return undefined;
  const match =
    language === "php"
      ? /^<<<[ \t]*(?:['"]?)([A-Za-z_]\w*)/.exec(
          source.slice(start, lineEnd(source, start)),
        )
      : /^<<[-~]?[ \t]*(?:['"`]?)([A-Za-z_]\w*)/.exec(
          source.slice(start, lineEnd(source, start)),
        );
  if (match === null) return undefined;
  let cursor = lineEnd(source, start);
  while (cursor < source.length) {
    const next = cursor + 1;
    const end = lineEnd(source, next);
    const line = source.slice(next, end).trim();
    if (
      line === match[1] ||
      (language === "php" && line === `${match[1]!};`)
    )
      return end;
    cursor = end;
  }
  return undefined;
}

function luaLongEnd(
  source: string,
  start: number,
  language: GraphLanguage,
): number | undefined {
  if (language !== "lua") return undefined;
  if (source[start] !== "[" && source[start] !== "-") return undefined;
  const match = /^(?:--)?\[(=*)\[/.exec(source.slice(start, start + 260));
  if (match === null) return undefined;
  return endingAfter(source, start + match[0].length, `]${match[1]!}]`);
}

function rubyPercentLiteralEnd(
  source: string,
  start: number,
): number | undefined {
  const match = /^%(?:[qQrwWiIxs])?([^A-Za-z0-9\s])/.exec(
    source.slice(start, start + 4),
  );
  if (match === null) return undefined;
  const open = match[1]!;
  const close = PAIRED_DELIMITERS.get(open) ?? open;
  let depth = 1;
  for (let index = start + match[0].length; index < source.length; index++) {
    if (source[index] === "\\") {
      index++;
    } else if (close !== open && source[index] === open) {
      depth++;
    } else if (source[index] === close && --depth === 0) {
      return index + 1;
    }
  }
  return source.length;
}

function startsSlashLiteral(
  source: string,
  start: number,
  language: "ruby" | "swift" | "typescript",
): boolean {
  if (slashLiteralEnd(source, start) === undefined) return false;
  let previous = start - 1;
  while (previous >= 0 && /\s/.test(source[previous]!)) previous--;
  if (previous < 0 || /[=([{,:;!&|?+*%~^<>-]/.test(source[previous]!))
    return true;
  const prefix = source.slice(Math.max(0, previous - 12), previous + 1);
  if (/\b(?:case|return|throw|yield)$/.test(prefix)) return true;
  // Reaching here means `slashLiteralEnd` already found a closing slash after
  // `start` (so `start + 1` is in range) and a non-whitespace char precedes
  // `start` (so `previous >= 0`, hence `start - 1` is in range). Neither index
  // is ever out of bounds, so a `?? ""` fallback here could never run.
  return (
    language === "ruby" &&
    /\s/.test(source[start - 1]!) &&
    !/\s/.test(source[start + 1]!)
  );
}

function slashLiteralEnd(source: string, start: number): number | undefined {
  let characterClass = false;
  for (let index = start + 1; index < source.length; index++) {
    const char = source[index]!;
    if (char === "\n" || char === "\r") return undefined;
    if (char === "\\") index++;
    else if (characterClass) {
      if (char === "]") characterClass = false;
    } else if (char === "[") characterClass = true;
    else if (char === "/") {
      index++;
      while (/[A-Za-z]/.test(source[index] ?? "")) index++;
      return index;
    }
  }
  return undefined;
}

function hasSlashComments(language: GraphLanguage): boolean {
  return !NO_SLASH_COMMENTS.has(language);
}

function hasBlockComments(language: GraphLanguage): boolean {
  return !NO_BLOCK_COMMENTS.has(language);
}

function hasHashComments(language: GraphLanguage): boolean {
  return language === "python" || language === "ruby" || language === "php";
}

const PAIRED_DELIMITERS = new Map([
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
  ["<", ">"],
]);

const NO_SLASH_COMMENTS = new Set<GraphLanguage>([
  "python",
  "ruby",
  "lua",
]);
const NO_BLOCK_COMMENTS = new Set<GraphLanguage>([
  "python",
  "ruby",
  "lua",
]);
const THIS_LANGUAGES = new Set<GraphLanguage>([
  "typescript",
  "cpp",
  "java",
  "csharp",
  "kotlin",
  "swift",
  "scala",
  "php",
  "dart",
]);
