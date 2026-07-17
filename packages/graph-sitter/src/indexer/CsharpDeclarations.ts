import { ISamchonGraphNode } from "../structures";
import { GraphNodeKind } from "../typings";

export namespace CsharpDeclarations {
  export interface ICSharpDeclaration {
    kind: GraphNodeKind;
    name: string;
    exported?: boolean;
    modifiers?: ISamchonGraphNode["modifiers"];
  }

  const TYPE_KINDS = new Set<GraphNodeKind>([
    "class",
    "interface",
    "enum",
    "type",
  ]);
  const STATEMENT_WORDS = new Set([
    "catch",
    "else",
    "for",
    "foreach",
    "if",
    "lock",
    "return",
    "switch",
    "throw",
    "using",
    "while",
  ]);

  /** Join the bounded declaration head that C# commonly splits over lines. */
  export function csharpDeclarationHeader(
    lines: readonly string[],
    start: number,
  ): string {
    const first = lines[start]!.trim();
    if (
      first === "" ||
      first.startsWith("[") ||
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
      if (
        parentheses === 0 &&
        (/[;{]/.test(lexical) || lexical.includes("=>"))
      )
        break;
    }
    return out.join(" ");
  }

  /** Parse C# declarations without treating statements and locals as members. */
  export function parseCSharpDeclaration(
    source: string,
    ownerName?: string,
    ownerKind?: GraphNodeKind,
  ): ICSharpDeclaration | undefined {
    const clean = eraseLeadingAttributes(
      source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ").trim(),
    );
    if (clean === "") return undefined;
    const declaration = stripModifiers(clean);

    const namespace =
      /^namespace\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\b/.exec(
        declaration,
      );
    if (namespace !== null) {
      return { kind: "namespace", name: namespace[1]! };
    }

    const ordinaryType =
      /^(class|struct|interface|enum)\s+([A-Za-z_$][\w$]*)\b/.exec(
        declaration,
      );
    if (ordinaryType !== null) {
      const kind =
        ordinaryType[1] === "interface"
          ? "interface"
          : ordinaryType[1] === "enum"
            ? "enum"
            : "class";
      return typeDeclaration(kind, ordinaryType[2]!, clean, ownerKind);
    }
    const record =
      /^record(?:\s+(?:class|struct))?\s+([A-Za-z_$][\w$]*)\b/.exec(
        declaration,
      );
    if (record !== null) {
      return typeDeclaration("class", record[1]!, clean, ownerKind);
    }
    if (declaration.startsWith("delegate ")) {
      const open = declaration.indexOf("(");
      const name =
        open === -1
          ? undefined
          : /([A-Za-z_$][\w$]*)\s*(?:<[^<>]*>)?\s*$/.exec(
              declaration.slice("delegate ".length, open).trim(),
            )?.[1];
      if (name !== undefined)
        return typeDeclaration("type", name, clean, ownerKind);
    }

    if (ownerName === undefined || !isTypeOwner(ownerKind)) return undefined;
    const modifiers = csharpGraphModifiersOf(clean, undefined, ownerKind);
    const open = declaration.indexOf("(");
    if (open !== -1) {
      const before = declaration.slice(0, open).trim();
      if (before !== "" && !/[=;{}]|=>/.test(before)) {
        const nameMatch = /([A-Za-z_$][\w$]*)\s*(?:<[^<>]*>)?\s*$/.exec(before);
        if (nameMatch !== null && !STATEMENT_WORDS.has(nameMatch[1]!)) {
          const name = nameMatch[1]!;
          const returnType = before.slice(0, nameMatch.index).trim();
          const ownerSimpleName = ownerName.slice(ownerName.lastIndexOf(".") + 1);
          const constructor = name === ownerSimpleName && returnType === "";
          const close = matchingParenthesisEnd(declaration, open);
          if (
            close !== -1 &&
            (constructor || isReturnType(returnType)) &&
            /^(?:\{|;|=>|:|where\b|$)/.test(declaration.slice(close + 1).trim())
          ) {
            return {
              kind: constructor ? "constructor" : "method",
              name,
              modifiers,
            };
          }
        }
      }
    }

    const property = /^(.+?)\s+([A-Za-z_$][\w$]*)\s*(?:\{|=>)/.exec(
      declaration,
    );
    if (property !== null && isReturnType(property[1]!.trim())) {
      return {
        kind: "property",
        name: property[2]!,
        modifiers,
      };
    }
    const field = /^(?:event\s+)?(.+?)\s+([A-Za-z_$][\w$]*)\s*(?:=|;)/.exec(
      declaration,
    );
    if (field !== null && isReturnType(field[1]!.trim())) {
      return {
        kind: "field",
        name: field[2]!,
        modifiers,
      };
    }
    return undefined;
  }

  /**
   * Recover C# modifiers, including language-default member visibility.
   *
   * A member of a type owner always comes back with at least one modifier: the
   * language gives every member a default visibility, so where a declaration
   * spells none this supplies it. That is why the member arms above assign
   * `modifiers` outright instead of guarding on its length — the empty case they
   * would be guarding against cannot occur past the `isTypeOwner` gate, and a
   * branch that cannot run is one no test can ever honestly cover.
   */
  export function csharpGraphModifiersOf(
    source: string,
    kind?: GraphNodeKind,
    ownerKind?: GraphNodeKind,
  ): NonNullable<ISamchonGraphNode["modifiers"]> {
    const clean = stripStringsAndComments(source);
    const out: NonNullable<ISamchonGraphNode["modifiers"]> = [];
    for (const match of clean.matchAll(
      /\b(public|private|protected|internal|static|abstract|readonly|async|const)\b/g,
    )) {
      const modifier = match[1] as NonNullable<
        ISamchonGraphNode["modifiers"]
      >[number];
      if (!out.includes(modifier)) out.push(modifier);
    }
    if (
      out.some(
        (modifier) =>
          modifier === "public" ||
          modifier === "private" ||
          modifier === "protected" ||
          modifier === "internal",
      )
    )
      return out;
    if (ownerKind === "interface") out.unshift("public");
    else if (ownerKind === "class") out.unshift("private");
    else if (kind !== undefined && TYPE_KINDS.has(kind)) out.unshift("internal");
    return out;
  }

  /** Restore the full namespace that csharp-ls shortens to its final segment. */
  export function csharpDocumentIdentity(
    name: string,
    owners: readonly string[],
    kind: GraphNodeKind | undefined,
    declarationLine: string,
  ): { name: string; owners: string[] } {
    if (kind !== "namespace") return { name, owners: [...owners] };
    const declared =
      /\bnamespace\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/.exec(
        declarationLine,
      )?.[1];
    if (declared === undefined) return { name, owners: [...owners] };
    const ownerPrefix = owners.join(".");
    const relative =
      ownerPrefix !== "" && declared.startsWith(`${ownerPrefix}.`)
        ? declared.slice(ownerPrefix.length + 1)
        : declared;
    const parts = relative.split(".");
    return {
      name: parts.at(-1)!,
      owners: [...owners, ...parts.slice(0, -1)],
    };
  }

  export function isCSharpPublishedType(
    kind: GraphNodeKind,
    ownerKinds: readonly GraphNodeKind[],
    modifiers: readonly string[] | undefined,
  ): boolean {
    return (
      TYPE_KINDS.has(kind) &&
      !ownerKinds.some(isTypeOwner) &&
      modifiers?.includes("public") === true
    );
  }

  export function csharpInheritanceRelation(
    sourceKind: GraphNodeKind,
    targetKind: GraphNodeKind,
    relation: "extends" | "implements",
  ): "extends" | "implements" {
    return sourceKind === "class" && targetKind === "interface"
      ? "implements"
      : relation;
  }

  function typeDeclaration(
    kind: GraphNodeKind,
    name: string,
    source: string,
    ownerKind: GraphNodeKind | undefined,
  ): ICSharpDeclaration {
    const modifiers = csharpGraphModifiersOf(source, kind, ownerKind);
    return {
      kind,
      name,
      modifiers,
      ...(modifiers.includes("public") ? { exported: true } : {}),
    };
  }

  function stripModifiers(source: string): string {
    let out = source;
    for (;;) {
      const modifier =
        /^(?:public|private|protected|internal|file|abstract|sealed|static|partial|readonly|ref|unsafe|new|virtual|override|async|extern|required|const)\b\s*/.exec(
          out,
        );
      if (modifier === null) return out;
      out = out.slice(modifier[0].length).trimStart();
    }
  }

  function eraseLeadingAttributes(source: string): string {
    let out = source;
    for (;;) {
      const attribute = /^\[[^\]]*\]\s*/.exec(out);
      if (attribute === null) return out;
      out = out.slice(attribute[0].length).trimStart();
    }
  }

  function isTypeOwner(kind: GraphNodeKind | undefined): boolean {
    return kind === "class" || kind === "interface";
  }

  function isReturnType(type: string): boolean {
    if (
      type === "" ||
      !/^[A-Za-z_$][\w$.:\s<>,?&*()[\]]*$/.test(type) ||
      /[=;{}]/.test(type)
    )
      return false;
    const words = type.match(/[A-Za-z_$][\w$]*/g) ?? [];
    return !words.some((word) => STATEMENT_WORDS.has(word));
  }

  function matchingParenthesisEnd(text: string, start: number): number {
    let depth = 0;
    for (let index = start; index < text.length; index++) {
      if (text[index] === "(") depth++;
      else if (text[index] === ")" && --depth === 0) return index;
    }
    return -1;
  }

  function stripStringsAndComments(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/.*$/gm, " ")
      .replace(/(["'])(?:\\.|(?!\1)[\s\S])*?\1/g, " ");
  }
}
