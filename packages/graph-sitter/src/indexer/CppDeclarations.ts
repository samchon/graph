import { ISamchonGraphNode } from "../structures";
import { GraphNodeKind } from "../typings";

export namespace CppDeclarations {
  export interface ICppDeclaration {
    kind: GraphNodeKind;
    name: string;
    exported?: boolean;
    modifiers?: ISamchonGraphNode["modifiers"];
    /** Explicit owners written by an out-of-line definition (`DBImpl::Get`). */
    ownerNames?: string[];
  }

  const STATEMENT_WORDS = new Set([
    "case",
    "catch",
    "co_await",
    "co_return",
    "delete",
    "do",
    "else",
    "for",
    "goto",
    "if",
    "new",
    "return",
    "sizeof",
    "switch",
    "throw",
    "while",
  ]);

  /** Join the bounded declaration head that C++ commonly splits over lines. */
  export function cppDeclarationHeader(
    lines: readonly string[],
    start: number,
  ): string {
    const first = lines[start]!.trim();
    if (
      first === "" ||
      first.startsWith("#") ||
      first.startsWith("//") ||
      first.startsWith("/*") ||
      first.startsWith("*") ||
      /^(?:public|private|protected)\s*:\s*$/.test(first)
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

  /** Parse C++ namespaces and callables without mistaking return types for names. */
  export function parseCppDeclaration(
    source: string,
    ownerName?: string,
    ownerKind?: GraphNodeKind,
  ): ICppDeclaration | undefined {
    const clean = source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/.*$/gm, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (
      clean === "" ||
      clean.startsWith("#") ||
      /^(?:public|private|protected)\s*:/.test(clean)
    )
      return undefined;

    const namespace =
      /^(?:inline\s+)?namespace(?:\s+((?:[A-Za-z_]\w*::)*[A-Za-z_]\w*))?\s*\{/.exec(
        clean,
      );
    if (namespace !== null) {
      const parts = namespace[1]?.split("::") ?? [];
      const name = parts.pop() ?? "(anonymous namespace)";
      return {
        kind: "namespace",
        name,
        ...(parts.length > 0 ? { ownerNames: parts } : {}),
        ...(namespace[1] === undefined ? { exported: false } : {}),
      };
    }

    const type = parseType(clean);
    if (type !== undefined) return type;

    if (
      ownerKind === "function" ||
      ownerKind === "method" ||
      ownerKind === "constructor"
    )
      return undefined;

    const open = clean.indexOf("(");
    if (open === -1) return undefined;
    const close = matchingParenthesisEnd(clean, open);
    if (close === -1 || !isCallableTail(clean.slice(close + 1).trim())) {
      return undefined;
    }

    const before = eraseLeadingTemplates(clean.slice(0, open).trim());
    const callable = /((?:[A-Za-z_]\w*::)*~?[A-Za-z_]\w*)\s*$/.exec(before);
    if (callable === null) return undefined;
    const qualified = callable[1]!;
    const parts = qualified.split("::");
    const name = parts.pop()!;
    if (STATEMENT_WORDS.has(name)) return undefined;

    const prefix = before.slice(0, callable.index).trim();
    const ownerNames = parts;
    const directOwner = ownerName?.split(".").at(-1);
    const constructorOwner = ownerNames.at(-1) ?? directOwner;
    const constructor =
      constructorOwner !== undefined &&
      (name === constructorOwner || name === `~${constructorOwner}`) &&
      isModifierOnly(prefix);
    if (!constructor && !isReturnType(prefix)) return undefined;

    const inType = ownerKind === "class" || ownerKind === "interface";
    const kind: GraphNodeKind = constructor
      ? "constructor"
      : ownerNames.length > 0 || inType
        ? "method"
        : "function";
    const fileLocal = kind === "function" && /\bstatic\b/.test(prefix);
    return {
      kind,
      name,
      ...(ownerNames.length > 0 ? { ownerNames } : {}),
      ...(kind === "function" ? { exported: !fileLocal } : {}),
      ...(fileLocal ? { modifiers: ["static"] } : {}),
    };
  }

  function eraseLeadingTemplates(source: string): string {
    let out = source;
    for (;;) {
      const template = /^template\s*<[^<>]*(?:<[^<>]*>[^<>]*)*>\s*/.exec(out);
      if (template === null) return out;
      out = out.slice(template[0].length).trimStart();
    }
  }

  function parseType(source: string): ICppDeclaration | undefined {
    const declaration = eraseLeadingTemplates(source);
    const match = /^(class|struct|union|enum(?:\s+(?:class|struct))?)\s+(.+?)(?:\s*:\s*(?!:)|\s*\{|\s*;)/.exec(
      declaration,
    );
    if (match === null) return undefined;
    const qualified = /((?:[A-Za-z_]\w*::)*[A-Za-z_]\w*)\s*$/.exec(
      match[2]!,
    )?.[1];
    if (qualified === undefined) return undefined;
    const parts = qualified.split("::");
    const name = parts.pop()!;
    return {
      kind: match[1]!.startsWith("enum") ? "enum" : "class",
      name,
      ...(parts.length > 0 ? { ownerNames: parts } : {}),
    };
  }

  function isReturnType(prefix: string): boolean {
    if (prefix === "" || /[;{}=]/.test(prefix)) return false;
    const words = prefix.match(/[A-Za-z_]\w*/g) ?? [];
    return (
      words.length > 0 &&
      !words.some((word) => STATEMENT_WORDS.has(word)) &&
      /[\w>&*\]]$/.test(prefix)
    );
  }

  function isModifierOnly(prefix: string): boolean {
    return /^(?:(?:constexpr|consteval|explicit|extern|friend|inline|static)\s+)*$/.test(
      prefix,
    );
  }

  function isCallableTail(tail: string): boolean {
    if (tail === "") return true;
    return /[;{]/.test(tail);
  }

  function matchingParenthesisEnd(text: string, start: number): number {
    let depth = 0;
    for (let index = start; index < text.length; index++) {
      if (text[index] === "(") depth++;
      else if (text[index] === ")" && --depth === 0) return index;
    }
    return -1;
  }

  function stripStringsAndComments(line: string): string {
    return line
      .replace(/\/\/.*$/, "")
      .replace(/(["'])(?:\\.|(?!\1).)*\1/g, "");
  }
}
