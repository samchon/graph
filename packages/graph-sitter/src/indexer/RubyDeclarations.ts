import { ISamchonGraphNode } from "../structures";
import { GraphNodeKind } from "../typings";

export namespace RubyDeclarations {
  export interface IRubyDeclaration {
    kind: GraphNodeKind;
    name: string;
    endIndex: number;
    exported?: boolean;
    modifiers?: ISamchonGraphNode["modifiers"];
  }

  type Visibility = "private" | "protected" | "public";

  interface IBlock {
    type: "block" | "class" | "def" | "module" | "singleton";
    declarationIndex?: number;
    visibility?: Visibility;
  }

  interface IMethodHead {
    name: string;
    explicitReceiver: boolean;
    endless: boolean;
    inlineVisibility?: Visibility;
  }

  interface ILexicalState {
    literal?: ILiteral;
  }

  interface ILiteral {
    open: string;
    close: string;
    depth: number;
    paired: boolean;
    interpolated: boolean;
    regex: boolean;
    characterClass: boolean;
    interpolationDepth: number;
    interpolationQuote?: string;
  }

  const BLOCK_KEYWORD = /\b(class|module|def|if|unless|case|begin|while|until|for|do|end)\b/g;
  const METHOD_NAME =
    /(?:[A-Za-z_]\w*[!?=]?|\[\]=?|<=>|===|==|=~|!~|<=|>=|<<|>>|\*\*|[-+*/%&|^~<>]=?|[+-]@)/;

  /**
   * Parse Ruby declarations and their `end`-delimited ranges in one lexical
   * pass. The generic static parser is brace-oriented; letting it search Ruby
   * bodies for a later `{}` block nests unrelated methods and classes together.
   */
  export function scan(
    lines: readonly string[],
  ): ReadonlyMap<number, IRubyDeclaration> {
    const declarations = new Map<number, IRubyDeclaration>();
    const lexicalLines = rubyLexicalLines(lines);
    const blocks: IBlock[] = [];

    for (let index = 0; index < lexicalLines.length; index++) {
      const source = lexicalLines[index]!;
      const trimmed = source.trim();
      const method = methodHeadOf(trimmed);
      const type = typeHeadOf(trimmed);
      const singleton = /^class\s*<<\s*(?:self|[A-Z]\w*(?:::[A-Z]\w*)*)\b/.test(
        trimmed,
      );
      const scope = nearestVisibilityScope(blocks);

      if (type !== undefined) {
        declarations.set(index, {
          kind: type.kind,
          name: type.name,
          endIndex: index,
          exported: true,
          modifiers: ["public"],
        });
      } else if (method !== undefined) {
        const inSingleton = blocks.some((block) => block.type === "singleton");
        const visibility =
          method.inlineVisibility ??
          (method.explicitReceiver && !inSingleton
            ? "public"
            : scope?.visibility ?? "public");
        const modifiers: NonNullable<ISamchonGraphNode["modifiers"]> = [
          visibility,
        ];
        if (method.explicitReceiver || inSingleton) modifiers.push("static");
        declarations.set(index, {
          kind: "method",
          name: method.name,
          endIndex: index,
          ...(visibility === "public" ? { exported: true } : {}),
          modifiers,
        });
      }

      const visibility = /^(private|protected|public)\s*;?$/.exec(trimmed)?.[1] as
        | Visibility
        | undefined;
      if (visibility !== undefined && scope !== undefined) {
        scope.visibility = visibility;
      }

      const loopOpenings: number[] = [];
      for (const token of rubyBlockTokens(source)) {
        if (token.keyword === "end") {
          const block = blocks.pop();
          if (block?.declarationIndex !== undefined) {
            const declaration = declarations.get(block.declarationIndex);
            if (declaration !== undefined) declaration.endIndex = index;
          }
          continue;
        }
        if (token.keyword === "class") {
          blocks.push({
            type: singleton && token.index === firstKeywordIndex(source, "class")
              ? "singleton"
              : "class",
            ...(type?.kind === "class" &&
            token.index === firstKeywordIndex(source, "class")
              ? { declarationIndex: index }
              : {}),
            visibility: "public",
          });
          continue;
        }
        if (token.keyword === "module") {
          blocks.push({
            type: "module",
            ...(type?.kind === "module" &&
            token.index === firstKeywordIndex(source, "module")
              ? { declarationIndex: index }
              : {}),
            visibility: "public",
          });
          continue;
        }
        if (token.keyword === "def") {
          if (
            method !== undefined &&
            method.endless &&
            token.index === firstKeywordIndex(source, "def")
          )
            continue;
          blocks.push({
            type: "def",
            ...(method !== undefined &&
            token.index === firstKeywordIndex(source, "def")
              ? { declarationIndex: index }
              : {}),
          });
          continue;
        }
        if (
          token.keyword === "if" ||
          token.keyword === "unless" ||
          token.keyword === "while" ||
          token.keyword === "until"
        ) {
          if (startsConditionalBlock(source, token.index)) {
            blocks.push({ type: "block" });
            if (token.keyword === "while" || token.keyword === "until") {
              loopOpenings.push(token.index);
            }
          }
          continue;
        }
        if (
          token.keyword === "case" ||
          token.keyword === "begin" ||
          token.keyword === "for"
        ) {
          blocks.push({ type: "block" });
          if (token.keyword === "for") loopOpenings.push(token.index);
          continue;
        }
        if (token.keyword === "do") {
          const statementStart = source.lastIndexOf(";", token.index) + 1;
          const pairedLoop = loopOpenings.some(
            (opening) => opening >= statementStart && opening < token.index,
          );
          if (!pairedLoop) blocks.push({ type: "block" });
        }
      }
    }
    return declarations;
  }

  function typeHeadOf(
    source: string,
  ): { kind: "class" | "module"; name: string } | undefined {
    const match = /^(class|module)\s+([A-Z]\w*(?:::[A-Z]\w*)*)\b/.exec(source);
    if (match === null) return undefined;
    return {
      kind: match[1] as "class" | "module",
      name: match[2]!.replace(/::/g, "."),
    };
  }

  function methodHeadOf(source: string): IMethodHead | undefined {
    const match = new RegExp(
      `^(?:(private|protected|public)\\s+)?def\\s+` +
        `(?:(self|[A-Z]\\w*(?:::[A-Z]\\w*)*)\\s*(?:\\.|::)\\s*)?` +
        `(${METHOD_NAME.source})(?=\\s|\\(|;|$)`,
    ).exec(source);
    if (match === null) return undefined;
    return {
      name: match[3]!,
      explicitReceiver: match[2] !== undefined,
      endless: isEndlessMethod(source.slice(match[0].length)),
      ...(match[1] === undefined
        ? {}
        : { inlineVisibility: match[1] as Visibility }),
    };
  }

  function isEndlessMethod(tail: string): boolean {
    let rest = tail.trimStart();
    if (rest.startsWith("(")) {
      const end = matchingDelimiter(rest, 0, "(", ")");
      if (end === -1) return false;
      rest = rest.slice(end + 1).trimStart();
    }
    return /^=(?!=)/.test(rest);
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

  function nearestVisibilityScope(blocks: readonly IBlock[]): IBlock | undefined {
    for (let index = blocks.length - 1; index >= 0; index--) {
      const block = blocks[index]!;
      if (
        block.type === "class" ||
        block.type === "module" ||
        block.type === "singleton"
      )
        return block;
    }
    return undefined;
  }

  function rubyBlockTokens(
    source: string,
  ): Array<{ keyword: string; index: number }> {
    const out: Array<{ keyword: string; index: number }> = [];
    BLOCK_KEYWORD.lastIndex = 0;
    for (
      let match = BLOCK_KEYWORD.exec(source);
      match !== null;
      match = BLOCK_KEYWORD.exec(source)
    ) {
      const before = source[match.index - 1];
      const after = source[match.index + match[0].length];
      if (before === ":" || before === "." || after === ":") continue;
      out.push({ keyword: match[1]!, index: match.index });
    }
    return out;
  }

  function startsConditionalBlock(source: string, index: number): boolean {
    const statement = source.slice(source.lastIndexOf(";", index) + 1, index);
    const prefix = statement.trimEnd();
    return (
      prefix === "" ||
      /(?:^|[=([{,])\s*$/.test(prefix) ||
      /\b(?:and|or|then)\s*$/.test(prefix)
    );
  }

  function firstKeywordIndex(source: string, keyword: string): number {
    return source.search(new RegExp(`\\b${keyword}\\b`));
  }

  /** Remove lexical regions whose `end`/block words are data, not Ruby code. */
  function rubyLexicalLines(lines: readonly string[]): string[] {
    const out: string[] = [];
    const heredocs: string[] = [];
    const lexicalState: ILexicalState = {};
    let blockComment = false;
    let data = false;
    for (const raw of lines) {
      const trimmed = raw.trim();
      if (data) {
        out.push("");
        continue;
      }
      if (lexicalState.literal === undefined && trimmed === "__END__") {
        data = true;
        out.push("");
        continue;
      }
      if (blockComment) {
        if (/^=end\b/.test(raw)) blockComment = false;
        out.push("");
        continue;
      }
      if (lexicalState.literal === undefined && /^=begin\b/.test(raw)) {
        blockComment = true;
        out.push("");
        continue;
      }
      if (heredocs.length > 0) {
        if (trimmed === heredocs[0]) heredocs.shift();
        out.push("");
        continue;
      }

      const lexical = stripRubyLiteralsAndComment(raw, lexicalState);
      // `class << self` opens a singleton class, not a heredoc named `self`.
      // Treating it as data erases every later method and both enclosing `end`
      // tokens, which in turn detaches the whole remainder of a Ruby file from
      // its class/module ownership tree.
      if (!/^\s*class\s*<<\s*(?:self|[A-Z]\w*(?:::[A-Z]\w*)*)\b/.test(raw)) {
        for (const match of raw.matchAll(
          /<<[-~]?\s*(?:["'`])?([A-Za-z_]\w*)(?:["'`])?/g,
        )) {
          if (lexical.slice(match.index, match.index + 2) === "<<") {
            heredocs.push(match[1]!);
          }
        }
      }
      out.push(lexical);
    }
    return out;
  }

  function stripRubyLiteralsAndComment(
    source: string,
    state: ILexicalState,
  ): string {
    let out = "";
    for (let index = 0; index < source.length; index++) {
      const char = source[index]!;
      const literal = state.literal;
      if (literal !== undefined) {
        out += " ";
        if (literal.interpolationDepth > 0) {
          if (literal.interpolationQuote !== undefined) {
            if (char === "\\") {
              if (index + 1 < source.length) {
                out += " ";
                index++;
              }
            } else if (char === literal.interpolationQuote) {
              literal.interpolationQuote = undefined;
            }
          } else if (char === "\\") {
            if (index + 1 < source.length) {
              out += " ";
              index++;
            }
          } else if (char === '"' || char === "'" || char === "`") {
            literal.interpolationQuote = char;
          } else if (char === "{") {
            literal.interpolationDepth++;
          } else if (char === "}" && --literal.interpolationDepth === 0) {
            literal.interpolationQuote = undefined;
          } else if (char === "#") {
            out += " ".repeat(source.length - index - 1);
            break;
          }
          continue;
        }
        if (char === "\\" && literal.close !== "\\") {
          if (index + 1 < source.length) {
            out += " ";
            index++;
          }
        } else if (
          literal.interpolated &&
          char === "#" &&
          source[index + 1] === "{"
        ) {
          out += " ";
          index++;
          literal.interpolationDepth = 1;
        } else if (literal.regex && literal.characterClass) {
          if (char === "]") literal.characterClass = false;
        } else if (literal.regex && char === "[") {
          literal.characterClass = true;
        } else if (literal.paired && char === literal.open) {
          literal.depth++;
        } else if (char === literal.close) {
          literal.depth--;
          if (literal.depth === 0) state.literal = undefined;
        }
      } else if (char === '"' || char === "'" || char === "`") {
        state.literal = createLiteral(
          char,
          char,
          false,
          char !== "'",
          false,
        );
        out += " ";
      } else if (char === "#") {
        out += " ".repeat(source.length - index);
        break;
      } else {
        const percent = /^%([qQrwWiIxs])([^A-Za-z0-9\s])/.exec(
          source.slice(index),
        );
        if (percent !== null) {
          const open = percent[2]!;
          const close = pairedDelimiter(open);
          state.literal = createLiteral(
            open,
            close ?? open,
            close !== undefined,
            /[QrWIx]/.test(percent[1]!),
            percent[1] === "r",
          );
          out += "   ";
          index += 2;
        } else if (char === "/" && startsSlashRegex(source, index, out)) {
          state.literal = createLiteral("/", "/", false, true, true);
          out += " ";
        } else out += char;
      }
    }
    return out;
  }

  function createLiteral(
    open: string,
    close: string,
    paired: boolean,
    interpolated: boolean,
    regex: boolean,
  ): ILiteral {
    return {
      open,
      close,
      depth: 1,
      paired,
      interpolated,
      regex,
      characterClass: false,
      interpolationDepth: 0,
    };
  }

  function pairedDelimiter(open: string): string | undefined {
    switch (open) {
      case "(":
        return ")";
      case "[":
        return "]";
      case "{":
        return "}";
      case "<":
        return ">";
      default:
        return undefined;
    }
  }

  function startsSlashRegex(
    source: string,
    index: number,
    lexicalPrefix: string,
  ): boolean {
    const prefix = lexicalPrefix.slice(0, index);
    const previous = /\S(?=\s*$)/.exec(prefix)?.[0];
    if (previous === undefined) return true;
    if (/[=([{,:;!&|?+*%~^<>-]/.test(previous)) return true;
    if (
      /\b(?:and|case|do|else|elsif|if|in|not|or|raise|rescue|return|then|throw|unless|until|when|while|yield)\s*$/.test(
        prefix,
      )
    )
      return true;
    if (!/\s/.test(source[index - 1] ?? "")) return false;
    // Ruby's command-call form permits `match /pattern/`, while `value / rhs`
    // is division. In that ambiguous lexer state a space immediately after the
    // slash is an operand boundary, not a regular-expression body.
    if (/\s/.test(source[index + 1] ?? "")) return false;
    const end = slashRegexEndIndex(source, index);
    if (end === undefined) return false;
    const tail = source
      .slice(end + 1)
      .replace(/^[imxoensu]+/, "")
      .trimStart();
    return (
      tail === "" ||
      /^(?:[),\]}.;]|\[|\{|&&|[|]{2}|=>|=~|!~|do\b|if\b|unless\b|while\b|until\b|and\b|or\b|then\b)/.test(
        tail,
      )
    );
  }

  function slashRegexEndIndex(
    source: string,
    start: number,
  ): number | undefined {
    let characterClass = false;
    let interpolationDepth = 0;
    let interpolationQuote: string | undefined;
    for (let index = start + 1; index < source.length; index++) {
      const char = source[index]!;
      if (interpolationDepth > 0) {
        if (interpolationQuote !== undefined) {
          if (char === "\\") index++;
          else if (char === interpolationQuote) interpolationQuote = undefined;
        } else if (char === "\\") index++;
        else if (char === '"' || char === "'" || char === "`") {
          interpolationQuote = char;
        } else if (char === "{") interpolationDepth++;
        else if (char === "}" && --interpolationDepth === 0) {
          interpolationQuote = undefined;
        } else if (char === "#") return undefined;
        continue;
      }
      if (char === "\\") {
        index++;
      } else if (char === "#" && source[index + 1] === "{") {
        interpolationDepth = 1;
        index++;
      } else if (characterClass) {
        if (char === "]") characterClass = false;
      } else if (char === "[") characterClass = true;
      else if (char === "/") return index;
    }
    return undefined;
  }
}
