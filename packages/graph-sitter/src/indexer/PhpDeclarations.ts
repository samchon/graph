import { ISamchonGraphNode } from "../structures";
import { GraphNodeKind } from "../typings";

export namespace PhpDeclarations {
  export interface IPhpDeclaration {
    kind: GraphNodeKind;
    name: string;
    exported?: boolean;
    modifiers?: ISamchonGraphNode["modifiers"];
  }

  export interface IPhpNamespaceIndex {
    lineStarts: readonly number[];
    scopes: readonly IPhpNamespaceScope[];
  }

  export interface IPhpNamespaceScope {
    end: number;
    name?: string;
    start: number;
  }

  interface IPhpNamespaceDeclaration {
    delimiter: ";" | "{";
    delimiterOffset: number;
    name?: string;
    start: number;
  }

  const TYPE_KINDS = new Set<GraphNodeKind>([
    "class",
    "interface",
    "enum",
  ]);

  /**
   * The tags that switch PHP between text and code. They delimit the code
   * region; they are never part of a declaration written inside it, so the head
   * a line begins is whatever follows the tag rather than the raw line.
   */
  const MODE_TAG = /^\s*(?:<\?(?:php\b|=)?|\?>)\s*/i;

  /** Index PHP namespace scopes while preserving LSP's UTF-16 source offsets. */
  export function indexPhpNamespaces(source: string): IPhpNamespaceIndex {
    const lexical = erasePhpNonCode(source);
    const declarations: IPhpNamespaceDeclaration[] = [];
    const pattern =
      /\bnamespace(?:\s+([A-Za-z_\x80-\xff][\w\x80-\xff]*(?:\s*\\\s*[A-Za-z_\x80-\xff][\w\x80-\xff]*)*))?\s*([;{])/gi;
    let depth = 0;
    let cursor = 0;
    for (let match = pattern.exec(lexical); match !== null; match = pattern.exec(
      lexical,
    )) {
      depth = braceDepthBetween(lexical, cursor, match.index, depth);
      const delimiterOffset = pattern.lastIndex - 1;
      if (depth === 0) {
        const rawName = match[1]?.replace(/\s+/g, "");
        declarations.push({
          delimiter: match[2] as ";" | "{",
          delimiterOffset,
          ...(rawName === undefined
            ? {}
            : { name: canonicalPhpOwner(rawName) }),
          start: match.index,
        });
      }
      depth = braceDepthBetween(
        lexical,
        match.index,
        pattern.lastIndex,
        depth,
      );
      cursor = pattern.lastIndex;
    }

    const scopes: IPhpNamespaceScope[] = declarations.map(
      (declaration, index) => ({
        start: declaration.delimiterOffset + 1,
        end:
          declaration.delimiter === ";"
            ? (declarations[index + 1]?.start ?? source.length)
            : matchingBraceOffset(lexical, declaration.delimiterOffset),
        ...(declaration.name === undefined
          ? {}
          : { name: declaration.name }),
      }),
    );
    const lineStarts = [0];
    for (let index = 0; index < source.length; index++) {
      if (source[index] === "\n") lineStarts.push(index + 1);
    }
    return { lineStarts, scopes };
  }

  /** Resolve the namespace active at an exact LSP line-and-character position. */
  export function phpNamespaceAt(
    index: IPhpNamespaceIndex,
    line: number,
    character: number,
  ): string | undefined {
    const lineStart = index.lineStarts[line];
    if (lineStart === undefined) return undefined;
    const offset = lineStart + Math.max(0, character);
    return index.scopes.find(
      (scope) => scope.start <= offset && offset < scope.end,
    )?.name;
  }

  /** Canonicalize a PHP LSP identity against its source namespace. */
  export function phpSymbolIdentity(
    name: string,
    owners: readonly string[],
    kind: GraphNodeKind | undefined,
    sourceNamespace: string | undefined,
  ): { name: string; owners: string[] } {
    if (kind === "namespace") {
      return { name: canonicalPhpOwner(name), owners: [] };
    }
    const canonicalOwners = owners
      .map(canonicalPhpOwner)
      .filter((owner) => owner !== "");
    const namespace =
      sourceNamespace === undefined
        ? undefined
        : canonicalPhpOwner(sourceNamespace);
    if (namespace === undefined || namespace === "") {
      return { name, owners: canonicalOwners };
    }
    const ownerPath = canonicalOwners.join(".");
    if (
      ownerPath === namespace ||
      ownerPath.startsWith(`${namespace}.`)
    ) {
      return { name, owners: canonicalOwners };
    }
    return { name, owners: [namespace, ...canonicalOwners] };
  }

  /** Join a bounded PHP declaration head split over parameters or base lists. */
  export function phpDeclarationHeader(
    lines: readonly string[],
    start: number,
  ): string {
    // Decide from the code the line carries, not from the tag that introduced
    // it. `<?php` alone is the line every PHP file opens with, and reading it
    // raw makes it look like a head still waiting for its `;` or `{`: the join
    // below then reaches into the following lines to find one and hands back
    // `<?php class PhpOwner {`. `parsePhpDeclaration` strips the tag and reports
    // the *next* line's class as though it were declared on the tag line, so the
    // class is emitted twice — once at the tag with a bogus name-relative column,
    // once at its own line — and because the phantom spans the real body it
    // becomes its own owner. Every member of a file's first declaration then
    // qualifies as `PhpOwner.PhpOwner.target`, which no caller can name.
    const first = lines[start]!.replace(MODE_TAG, "").trim();
    if (
      first === "" ||
      first.startsWith("#[") ||
      first.startsWith("//") ||
      first.startsWith("/*") ||
      first.startsWith("*")
    )
      return lines[start]!;
    const out: string[] = [];
    let parentheses = 0;
    for (let index = start; index < Math.min(lines.length, start + 32); index++) {
      const raw = lines[index]!;
      const lexical = stripStringsAndComments(raw);
      out.push(raw.trim());
      for (const char of lexical) {
        if (char === "(") parentheses++;
        else if (char === ")") parentheses = Math.max(0, parentheses - 1);
      }
      if (parentheses === 0 && /[;{]/.test(lexical)) break;
    }
    return out.join(" ");
  }

  /** Parse PHP declarations without promoting statements or closures. */
  export function parsePhpDeclaration(
    source: string,
    _ownerName?: string,
    ownerKind?: GraphNodeKind,
  ): IPhpDeclaration | undefined {
    const clean = eraseLeadingAttributes(
      stripStringsAndComments(source)
        .replace(/^\s*<\?(?:php|=)?\s*/i, "")
        .trim(),
    );
    if (clean === "") return undefined;
    const declaration = stripModifiers(clean);

    const namespace =
      /^namespace\s+([A-Za-z_\x80-\xff][\w\x80-\xff]*(?:\\[A-Za-z_\x80-\xff][\w\x80-\xff]*)*)\b/i.exec(
        declaration,
      );
    if (namespace !== null) {
      return {
        kind: "namespace",
        name: canonicalPhpOwner(namespace[1]!),
      };
    }

    const type = /^(class|interface|trait|enum)\s+([A-Za-z_\x80-\xff][\w\x80-\xff]*)\b/i.exec(
      declaration,
    );
    if (type !== null) {
      const kind: GraphNodeKind =
        type[1]!.toLowerCase() === "interface" ||
        type[1]!.toLowerCase() === "trait"
          ? "interface"
          : type[1]!.toLowerCase() === "enum"
            ? "enum"
            : "class";
      const modifiers = phpGraphModifiersOf(clean, kind, ownerKind);
      return {
        kind,
        name: type[2]!,
        exported: isTypeOwner(ownerKind) ? undefined : true,
        ...(modifiers.length > 0 ? { modifiers } : {}),
      };
    }

    const callable = /^function\s+&?\s*([A-Za-z_\x80-\xff][\w\x80-\xff]*)\s*\(/i.exec(
      declaration,
    );
    if (callable !== null) {
      const member = isTypeOwner(ownerKind);
      const kind: GraphNodeKind = member
        ? callable[1]!.toLowerCase() === "__construct"
          ? "constructor"
          : "method"
        : "function";
      const modifiers = phpGraphModifiersOf(clean, kind, ownerKind);
      return {
        kind,
        name: callable[1]!,
        exported: member ? undefined : true,
        ...(modifiers.length > 0 ? { modifiers } : {}),
      };
    }

    if (!isTypeOwner(ownerKind)) return undefined;
    const property = /^(?:var\s+)?(?:[^$;=(){}]+\s+)?\$([A-Za-z_\x80-\xff][\w\x80-\xff]*)\b/.exec(
      declaration,
    );
    if (property !== null) {
      const modifiers = phpGraphModifiersOf(clean, "property", ownerKind);
      return {
        kind: "property",
        name: property[1]!,
        ...(modifiers.length > 0 ? { modifiers } : {}),
      };
    }
    const constant = /^const\s+([A-Za-z_\x80-\xff][\w\x80-\xff]*)\b/i.exec(
      declaration,
    );
    if (constant !== null) {
      const modifiers = phpGraphModifiersOf(clean, "field", ownerKind);
      if (!modifiers.includes("const")) modifiers.push("const");
      return {
        kind: "field",
        name: constant[1]!,
        ...(modifiers.length > 0 ? { modifiers } : {}),
      };
    }
    return undefined;
  }

  /** Recover PHP modifiers, including PHP's implicit public member visibility. */
  export function phpGraphModifiersOf(
    source: string,
    kind?: GraphNodeKind,
    ownerKind?: GraphNodeKind,
  ): NonNullable<ISamchonGraphNode["modifiers"]> {
    const clean = stripStringsAndComments(source);
    const out: NonNullable<ISamchonGraphNode["modifiers"]> = [];
    for (const match of clean.matchAll(
      /\b(public|private|protected|static|abstract|readonly|const)\b/gi,
    )) {
      const modifier = match[1]!.toLowerCase() as NonNullable<
        ISamchonGraphNode["modifiers"]
      >[number];
      if (!out.includes(modifier)) out.push(modifier);
    }
    if (/\bvar\b/i.test(clean) && !hasVisibility(out)) out.unshift("public");
    if (
      isTypeOwner(ownerKind) &&
      isMemberKind(kind) &&
      !hasVisibility(out)
    )
      out.unshift("public");
    return out;
  }

  /** PHP namespaces are structural; their direct declarations are public API. */
  export function isPhpPublishedDeclaration(
    kind: GraphNodeKind,
    ownerKinds: readonly GraphNodeKind[],
  ): boolean {
    return (
      (TYPE_KINDS.has(kind) || kind === "function") &&
      !ownerKinds.some(isTypeOwner)
    );
  }

  function stripModifiers(source: string): string {
    let out = source;
    for (;;) {
      const modifier = /^(?:public|private|protected|static|abstract|final|readonly|var)\b\s*/i.exec(
        out,
      );
      if (modifier === null) return out;
      out = out.slice(modifier[0].length).trimStart();
    }
  }

  function eraseLeadingAttributes(source: string): string {
    let out = source;
    for (;;) {
      const attribute = /^#\[(?:[^\]"']|"(?:\\.|[^"])*"|'(?:\\.|[^'])*')*\]\s*/.exec(
        out,
      );
      if (attribute === null) return out;
      out = out.slice(attribute[0].length).trimStart();
    }
  }

  function hasVisibility(
    modifiers: readonly string[],
  ): boolean {
    return modifiers.some(
      (modifier) =>
        modifier === "public" ||
        modifier === "private" ||
        modifier === "protected",
    );
  }

  function isMemberKind(kind: GraphNodeKind | undefined): boolean {
    return (
      kind === "method" ||
      kind === "constructor" ||
      kind === "property" ||
      kind === "field"
    );
  }

  function isTypeOwner(kind: GraphNodeKind | undefined): boolean {
    return kind === "class" || kind === "interface" || kind === "enum";
  }

  function braceDepthBetween(
    source: string,
    start: number,
    end: number,
    initial: number,
  ): number {
    let depth = initial;
    for (let index = start; index < end; index++) {
      if (source[index] === "{") depth++;
      else if (source[index] === "}") depth = Math.max(0, depth - 1);
    }
    return depth;
  }

  function canonicalPhpOwner(name: string): string {
    return name
      .replaceAll("\\", ".")
      .split(".")
      .map((part) => part.trim())
      .filter((part) => part !== "")
      .join(".");
  }

  function matchingBraceOffset(source: string, open: number): number {
    let depth = 0;
    for (let index = open; index < source.length; index++) {
      if (source[index] === "{") depth++;
      else if (source[index] === "}" && --depth === 0) return index;
    }
    return source.length;
  }

  /** Replace PHP non-code with spaces without changing any source offset. */
  function erasePhpNonCode(source: string): string {
    const out = source.split("");
    const erase = (start: number, end: number): void => {
      for (let index = start; index < end; index++) {
        if (out[index] !== "\n" && out[index] !== "\r") out[index] = " ";
      }
    };
    for (let index = 0; index < source.length; ) {
      if (source.startsWith("//", index)) {
        const end = source.indexOf("\n", index + 2);
        const stop = end === -1 ? source.length : end;
        erase(index, stop);
        index = stop;
        continue;
      }
      if (source[index] === "#" && source[index + 1] !== "[") {
        const end = source.indexOf("\n", index + 1);
        const stop = end === -1 ? source.length : end;
        erase(index, stop);
        index = stop;
        continue;
      }
      if (source.startsWith("/*", index)) {
        const close = source.indexOf("*/", index + 2);
        const stop = close === -1 ? source.length : close + 2;
        erase(index, stop);
        index = stop;
        continue;
      }
      const quote = source[index];
      if (quote === '"' || quote === "'" || quote === "`") {
        let stop = index + 1;
        while (stop < source.length) {
          if (source[stop] === "\\") stop += 2;
          else if (source[stop++] === quote) break;
        }
        erase(index, Math.min(stop, source.length));
        index = Math.min(stop, source.length);
        continue;
      }
      if (source.startsWith("<<<", index)) {
        const header = /^<<<[ \t]*(?:'([A-Za-z_][\w]*)'|"([A-Za-z_][\w]*)"|([A-Za-z_][\w]*))[ \t]*\r?\n/.exec(
          source.slice(index),
        );
        if (header !== null) {
          const label = header[1] ?? header[2] ?? header[3] ?? "";
          let stop = index + header[0].length;
          while (stop < source.length) {
            const lineEnd = source.indexOf("\n", stop);
            const end = lineEnd === -1 ? source.length : lineEnd + 1;
            const line = source.slice(stop, end).replace(/\r?\n$/, "");
            if (
              new RegExp(
                `^[ \\t]*${escapeRegExp(label)}(?=;|,|\\)|\\]|\\}|[ \\t]*$)`,
              ).test(line)
            ) {
              stop = end;
              break;
            }
            stop = end;
          }
          erase(index, stop);
          index = stop;
          continue;
        }
      }
      index++;
    }
    return out.join("");
  }

  function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function stripStringsAndComments(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/.*$/gm, " ")
      .replace(/(^|\s)#(?!\[).*$/gm, "$1")
      .replace(/(["'])(?:\\.|(?!\1)[\s\S])*?\1/g, " ");
  }
}
