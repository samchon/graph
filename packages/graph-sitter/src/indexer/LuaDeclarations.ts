import { ISamchonGraphNode } from "../structures";
import { GraphNodeKind } from "../typings";

export namespace LuaDeclarations {
  export interface ILuaDeclaration {
    kind: GraphNodeKind;
    name: string;
    ownerNames?: string[];
    endIndex: number;
    exported?: boolean;
    modifiers: ISamchonGraphNode["modifiers"];
  }

  interface IDeclarationState {
    declaration: ILuaDeclaration;
    canonicalName: string;
    local: boolean;
    root: string;
    topLevel: boolean;
  }

  interface IBlock {
    type: "end" | "repeat";
    function?: true;
    declarationIndex?: number;
  }

  interface ITableOwner {
    name: string;
    depth: number;
  }

  interface IFunctionHead {
    kind: "function" | "method";
    name: string;
    ownerNames?: string[];
    local: boolean;
    functionIndex: number;
  }

  const BLOCK_KEYWORD = /\b(function|if|for|while|do|repeat|until|end)\b/g;
  const IDENTIFIER = "[A-Za-z_]\\w*";
  const PATH = `${IDENTIFIER}(?:(?:\\.|:)${IDENTIFIER})*`;

  /**
   * Parse Lua's named callable forms and match every function to its real
   * `end`. The shared fallback is brace-oriented, while Lua declarations use
   * `end` and commonly put the callable name before `= function`; treating the
   * declaration as one line erases its calls and makes later functions appear
   * to be nested in whichever unrelated table literal supplied a brace.
   */
  export function scan(
    lines: readonly string[],
  ): ReadonlyMap<number, ILuaDeclaration> {
    const lexicalLines = luaLexicalLines(lines);
    const states = new Map<number, IDeclarationState>();
    const blocks: IBlock[] = [];
    const localNames = new Set<string>();
    const returnedRoots = new Set<string>();
    const returnedBindings = new Set<string>();
    const tableOwners: ITableOwner[] = [];
    let returnTableDepth: number | undefined;
    let braceDepth = 0;

    for (let index = 0; index < lexicalLines.length; index++) {
      const source = lexicalLines[index]!;
      const trimmed = source.trim();
      while (
        tableOwners.length > 0 &&
        braceDepth < tableOwners[tableOwners.length - 1]!.depth
      ) {
        tableOwners.pop();
      }

      const topLevel = !blocks.some((block) => block.function === true);
      const localBinding = new RegExp(
        `^local\\s+(${IDENTIFIER})\\b`,
      ).exec(trimmed)?.[1];
      if (topLevel && localBinding !== undefined) localNames.add(localBinding);
      if (blocks.length === 0) {
        const returned = new RegExp(`^return\\s+(${IDENTIFIER})\\s*;?$`).exec(
          trimmed,
        )?.[1];
        if (returned !== undefined) returnedRoots.add(returned);
        if (returnTableDepth === undefined && /^return\s*\{/.test(trimmed)) {
          returnTableDepth = 0;
        }
        if (returnTableDepth !== undefined) {
          if (returnTableDepth <= 1) {
            const fieldBinding = new RegExp(
              `(?:^|[{,])\\s*(?:${IDENTIFIER}|\\[[^\\]]+\\])\\s*=\\s*(${PATH})\\b`,
              "g",
            );
            for (
              let match = fieldBinding.exec(source);
              match !== null;
              match = fieldBinding.exec(source)
            ) {
              returnedBindings.add(canonicalName(match[1]!));
            }
          }
          returnTableDepth += braceDelta(source);
          if (returnTableDepth <= 0) returnTableDepth = undefined;
        }
      }

      // A table literal can remain lexically open across a field function's
      // whole body. Only direct fields inherit that table owner; an assignment
      // nested inside the field function is a closure/local runtime binding,
      // not another member of the outer module table.
      const activeTable = topLevel ? tableOwners.at(-1)?.name : undefined;
      const head = functionHeadOf(source, activeTable);
      if (head !== undefined) {
        const root = head.ownerNames?.[0] ?? head.name;
        states.set(index, {
          declaration: {
            kind: head.kind,
            name: head.name,
            ...(head.ownerNames === undefined
              ? {}
              : { ownerNames: head.ownerNames }),
            endIndex: index,
            modifiers: [],
          },
          canonicalName: [...(head.ownerNames ?? []), head.name].join("."),
          local: head.local || localNames.has(root),
          root,
          topLevel,
        });
      }

      let loopOpening = false;
      for (const token of blockTokens(source)) {
        if (token.keyword === "end") {
          closeBlock(blocks, states, index, "end");
          continue;
        }
        if (token.keyword === "until") {
          closeBlock(blocks, states, index, "repeat");
          continue;
        }
        if (token.keyword === "repeat") {
          blocks.push({ type: "repeat" });
          continue;
        }
        if (token.keyword === "function") {
          blocks.push({
            type: "end",
            function: true,
            ...(head !== undefined && token.index === head.functionIndex
              ? { declarationIndex: index }
              : {}),
          });
          continue;
        }
        if (
          token.keyword === "if" ||
          token.keyword === "for" ||
          token.keyword === "while"
        ) {
          blocks.push({ type: "end" });
          if (token.keyword === "for" || token.keyword === "while") {
            loopOpening = true;
          }
          continue;
        }
        if (token.keyword === "do") {
          if (loopOpening) loopOpening = false;
          else blocks.push({ type: "end" });
        }
      }

      const table = tableAssignmentOf(source);
      const delta = braceDelta(source);
      if (table !== undefined && delta > 0) {
        tableOwners.push({ name: table, depth: braceDepth + 1 });
      }
      braceDepth = Math.max(0, braceDepth + delta);
    }

    for (const state of states.values()) {
      const published =
        state.topLevel &&
        (!state.local ||
          returnedRoots.has(state.root) ||
          returnedBindings.has(state.canonicalName));
      state.declaration.modifiers = [published ? "public" : "private"];
      if (published) state.declaration.exported = true;
    }
    return new Map(
      [...states].map(([index, state]) => [index, state.declaration]),
    );
  }

  /** A receiver-independent lookup key for Lua's dynamic `obj.foo`/`obj:foo`. */
  export function leafName(name: string): string {
    return name.slice(Math.max(name.lastIndexOf("."), name.lastIndexOf(":")) + 1);
  }

  /** Treat method-call `:` and table-member `.` as the same handle boundary. */
  export function canonicalName(name: string): string {
    return name.replaceAll(":", ".");
  }

  /** Split a Lua table/member spelling into the graph's dotted owner identity. */
  export function identityOf(name: string): {
    name: string;
    ownerNames?: string[];
  } {
    const parts = canonicalName(name).split(".");
    const leaf = parts.pop()!;
    return {
      name: leaf,
      ...(parts.length === 0 ? {} : { ownerNames: parts }),
    };
  }

  function functionHeadOf(
    source: string,
    tableOwner: string | undefined,
  ): IFunctionHead | undefined {
    const trimmed = source.trim();
    const declared = new RegExp(
      `^(local\\s+)?function\\s+(${PATH})\\s*\\(([^)]*)`,
    ).exec(trimmed);
    if (declared !== null) {
      const written = declared[2]!;
      const identity = identityOf(written);
      return {
        kind: written.includes(":") ? "method" : "function",
        ...identity,
        local: declared[1] !== undefined,
        functionIndex: source.indexOf("function"),
      };
    }

    const assigned = new RegExp(
      `^(local\\s+)?(${PATH})\\s*=\\s*function\\s*\\(([^)]*)`,
    ).exec(trimmed);
    if (assigned !== null) {
      const parameters = assigned[3]!
        .split(",")
        .map((parameter) => parameter.trim())
        .filter((parameter) => parameter !== "");
      const direct = assigned[2]!;
      const tableField =
        assigned[1] === undefined &&
        tableOwner !== undefined &&
        !/[.:]/.test(direct);
      const written = tableField ? `${tableOwner}.${direct}` : direct;
      const identity = identityOf(written);
      return {
        kind:
          written.includes(":") || (tableField && parameters[0] === "self")
            ? "method"
            : "function",
        ...identity,
        local: assigned[1] !== undefined || tableField,
        functionIndex: source.indexOf("function"),
      };
    }
    return undefined;
  }

  function closeBlock(
    blocks: IBlock[],
    states: Map<number, IDeclarationState>,
    endIndex: number,
    type: IBlock["type"],
  ): void {
    for (let index = blocks.length - 1; index >= 0; index--) {
      const block = blocks[index]!;
      if (block.type !== type) continue;
      blocks.splice(index, 1);
      if (block.declarationIndex !== undefined) {
        const state = states.get(block.declarationIndex);
        if (state !== undefined) state.declaration.endIndex = endIndex;
      }
      return;
    }
  }

  function tableAssignmentOf(source: string): string | undefined {
    return new RegExp(
      `^\\s*(?:local\\s+)?(${IDENTIFIER})\\s*=.*\\{`,
    ).exec(source)?.[1];
  }

  function braceDelta(source: string): number {
    let delta = 0;
    for (const char of source) {
      if (char === "{") delta++;
      else if (char === "}") delta--;
    }
    return delta;
  }

  function blockTokens(
    source: string,
  ): Array<{ keyword: string; index: number }> {
    const out: Array<{ keyword: string; index: number }> = [];
    BLOCK_KEYWORD.lastIndex = 0;
    for (
      let match = BLOCK_KEYWORD.exec(source);
      match !== null;
      match = BLOCK_KEYWORD.exec(source)
    ) {
      out.push({ keyword: match[1]!, index: match.index });
    }
    return out;
  }

  /** Blank strings, line comments, long strings, and long comments by line. */
  function luaLexicalLines(lines: readonly string[]): string[] {
    const out: string[] = [];
    let longClose: string | undefined;
    for (const raw of lines) {
      let lexical = "";
      let quote: "'" | '"' | undefined;
      for (let index = 0; index < raw.length; index++) {
        if (longClose !== undefined) {
          const end = raw.indexOf(longClose, index);
          if (end === -1) {
            lexical += " ".repeat(raw.length - index);
            index = raw.length;
          } else {
            lexical += " ".repeat(end + longClose.length - index);
            index = end + longClose.length - 1;
            longClose = undefined;
          }
          continue;
        }
        const char = raw[index]!;
        if (quote !== undefined) {
          lexical += " ";
          if (char === "\\") {
            if (index + 1 < raw.length) {
              lexical += " ";
              index++;
            }
          } else if (char === quote) quote = undefined;
          continue;
        }
        if (char === "'" || char === '"') {
          quote = char;
          lexical += " ";
          continue;
        }
        if (raw.startsWith("--", index)) {
          const long = /^--\[(=*)\[/.exec(raw.slice(index));
          if (long !== null) {
            longClose = `]${long[1]!}]`;
            lexical += " ".repeat(long[0].length);
            index += long[0].length - 1;
            continue;
          }
          lexical += " ".repeat(raw.length - index);
          break;
        }
        if (char === "[") {
          const long = /^\[(=*)\[/.exec(raw.slice(index));
          if (long !== null) {
            longClose = `]${long[1]!}]`;
            lexical += " ".repeat(long[0].length);
            index += long[0].length - 1;
            continue;
          }
        }
        lexical += char;
      }
      out.push(lexical);
    }
    return out;
  }
}
