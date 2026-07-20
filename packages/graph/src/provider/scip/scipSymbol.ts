import { GraphNodeKind } from "../../typings";

/** One parsed SCIP symbol string. */
interface IParsedSymbol {
  /**
   * Whether this symbol is stable across rebuilds.
   *
   * A `local N` symbol is an index-local counter: the same declaration can be
   * `local 3` today and `local 7` after an unrelated edit above it. Treating
   * it as persistent identity would make every rebuild look like a rename of
   * half the file's locals, so it is marked here and the node id derived from
   * it is scoped to its generation.
   */
  stability: "persistent" | "generation";

  /** The full symbol string, unmodified — the provider's own key. */
  key: string;

  /** The last descriptor's name, or `""` when the symbol carries none. */
  displayName: string;

  /**
   * The enclosing descriptors' names, outermost first.
   *
   * Used to attach containment when the index does not state
   * `enclosingSymbol`, and never to invent an owner the descriptors do not
   * name.
   */
  owners: string[];

  /** What the final descriptor's suffix says this symbol is. */
  descriptor: IParsedSymbol.Descriptor | undefined;
}

namespace IParsedSymbol {
  /**
   * The descriptor suffix SCIP uses to say what a name denotes.
   *
   * This is a syntactic fact about the symbol string, not a semantic kind: a
   * `method` descriptor tells you the indexer wrote `foo().`, which is a
   * stronger statement than any guess made from the display name, and a weaker
   * one than {@link IScipIndex.ISymbolInformation.kind}. Both are consulted,
   * in that order of preference.
   */
  export type Descriptor =
    | "namespace"
    | "type"
    | "term"
    | "method"
    | "type-parameter"
    | "parameter"
    | "meta"
    | "macro";
}

/**
 * Parse a SCIP symbol string into the identity facts the graph derives ids
 * from.
 *
 * Deliberately tolerant about the package coordinates and strict about the
 * descriptors: the graph never reads the manager, package name, or version —
 * two indexers spell them differently for the same dependency — while the
 * descriptor tail is what names the symbol and its owners.
 *
 * Returns `undefined` for a symbol this parser cannot read, and the caller
 * drops the occurrence with a warning. Guessing a display name out of an
 * unparseable string is how a graph acquires nodes named after punctuation.
 */
export function scipSymbol(symbol: string): IParsedSymbol | undefined {
  if (symbol === "") return undefined;
  if (symbol.startsWith("local ")) {
    const id = symbol.slice("local ".length).trim();
    if (id === "") return undefined;
    return {
      stability: "generation",
      key: symbol,
      displayName: id,
      owners: [],
      descriptor: "term",
    };
  }

  // `<scheme> <manager> <package> <version> <descriptors>` — five space-
  // separated fields, of which only the last is read. A scheme with fewer
  // fields is not a symbol this parser understands.
  const head = splitPackage(symbol);
  if (head === undefined) return undefined;
  const descriptors = parseDescriptors(head);
  if (descriptors === undefined || descriptors.length === 0) return undefined;
  const last = descriptors[descriptors.length - 1]!;
  return {
    stability: "persistent",
    key: symbol,
    displayName: last.name,
    owners: descriptors.slice(0, -1).map((entry) => entry.name),
    descriptor: last.descriptor,
  };
}

export namespace scipSymbol {
  /** One parsed symbol string, as {@link scipSymbol} returns it. */
  export type IParsed = IParsedSymbol;

  /** What a symbol's final descriptor suffix says it denotes. */
  export type Descriptor = IParsedSymbol.Descriptor;

  /**
   * Map a symbol's descriptor and the index's own kind onto a graph node kind.
   *
   * The index's `kind` wins when it maps, because it is the indexer's semantic
   * statement; the descriptor is the fallback, because it is at least the
   * indexer's syntactic one. When neither maps, the symbol has no kind this
   * graph models and the caller omits the node rather than defaulting it to
   * `variable` — a wrong kind is worse than an absent one, since every ranking
   * and traversal reads it as fact.
   */
  export const nodeKind = scipNodeKindImpl;
}

function scipNodeKindImpl(
  kind: string | undefined,
  descriptor: IParsedSymbol.Descriptor | undefined,
): GraphNodeKind | undefined {
  const mapped = kind === undefined ? undefined : SCIP_KINDS.get(kind);
  if (mapped !== undefined) return mapped;
  switch (descriptor) {
    case "namespace":
      return "namespace";
    case "type":
      return "class";
    case "method":
      return "method";
    case "term":
      return "variable";
    case "macro":
      return "function";
    // A type parameter, a value parameter, and a `meta` descriptor are real
    // SCIP descriptors that this graph does not model as declarations of their
    // own, and an absent descriptor says nothing at all. None of them gets a
    // fallback kind: the caller omits the node instead, because a guessed kind
    // is read as fact by every ranking and traversal downstream.
    case "type-parameter":
    case "parameter":
    case "meta":
    case undefined:
      return undefined;
  }
}

/**
 * SCIP's `SymbolInformation.Kind` names, mapped to the kinds this graph models.
 *
 * Names absent here are not defaulted. SCIP's enum is much wider than the
 * graph's vocabulary — it distinguishes a `SelfParameter` from a `Parameter`
 * and an `AbstractMethod` from a `Method` — and collapsing an unknown one onto
 * the nearest guess would publish a kind the indexer never claimed.
 */
const SCIP_KINDS = new Map<string, GraphNodeKind>([
  ["Namespace", "namespace"],
  ["Package", "package"],
  ["Module", "module"],
  ["File", "file"],
  ["Class", "class"],
  ["AbstractClass", "class"],
  ["Struct", "class"],
  ["Object", "class"],
  ["Trait", "interface"],
  ["Interface", "interface"],
  ["Protocol", "interface"],
  ["Enum", "enum"],
  ["EnumMember", "field"],
  ["Type", "type"],
  ["TypeAlias", "type"],
  ["TypeParameter", "type"],
  ["Function", "function"],
  ["Macro", "function"],
  ["Method", "method"],
  ["AbstractMethod", "method"],
  ["StaticMethod", "method"],
  ["MethodSpecification", "method"],
  ["Constructor", "constructor"],
  ["Field", "field"],
  ["Property", "property"],
  ["Getter", "property"],
  ["Setter", "property"],
  ["Variable", "variable"],
  ["Constant", "variable"],
  ["Parameter", "parameter"],
  ["SelfParameter", "parameter"],
  ["TypeParameterKind", "type"],
]);

/** Everything after the fifth space-separated field, or `undefined`. */
function splitPackage(symbol: string): string | undefined {
  let index = 0;
  for (let field = 0; field < 4; field++) {
    const next = symbol.indexOf(" ", index);
    if (next === -1) return undefined;
    index = next + 1;
  }
  const tail = symbol.slice(index);
  return tail === "" ? undefined : tail;
}

interface IDescriptor {
  name: string;
  descriptor: IParsedSymbol.Descriptor;
}

/**
 * Split a descriptor tail into its named parts.
 *
 * Backtick escaping is honoured because a descriptor name may itself contain
 * the suffix characters — a Scala symbol legitimately named `` `foo#bar` ``
 * would otherwise be cut in half at a `#` that is part of its name.
 */
function parseDescriptors(tail: string): IDescriptor[] | undefined {
  const parts: IDescriptor[] = [];
  let index = 0;
  while (index < tail.length) {
    const parsed = parseOne(tail, index);
    if (parsed === undefined) return undefined;
    parts.push(parsed.descriptor);
    index = parsed.next;
  }
  return parts;
}

function parseOne(
  tail: string,
  start: number,
): { descriptor: IDescriptor; next: number } | undefined {
  const opener = tail[start]!;
  if (opener === "[" || opener === "(") {
    const closer = opener === "[" ? "]" : ")";
    const name = readName(tail, start + 1, closer);
    if (name === undefined) return undefined;
    return {
      descriptor: {
        name: name.value,
        descriptor: opener === "[" ? "type-parameter" : "parameter",
      },
      next: name.next + 1,
    };
  }
  const name = readName(tail, start, undefined);
  if (name === undefined) return undefined;
  const suffix = tail[name.next];
  if (suffix === undefined) return undefined;
  switch (suffix) {
    case "/":
      return {
        descriptor: { name: name.value, descriptor: "namespace" },
        next: name.next + 1,
      };
    case "#":
      return {
        descriptor: { name: name.value, descriptor: "type" },
        next: name.next + 1,
      };
    case ".":
      return {
        descriptor: { name: name.value, descriptor: "term" },
        next: name.next + 1,
      };
    case ":":
      return {
        descriptor: { name: name.value, descriptor: "meta" },
        next: name.next + 1,
      };
    case "!":
      return {
        descriptor: { name: name.value, descriptor: "macro" },
        next: name.next + 1,
      };
    case "(": {
      // `name(disambiguator).` — the disambiguator distinguishes overloads and
      // is part of the provider key, not of the display name.
      const close = tail.indexOf(")", name.next + 1);
      if (close === -1 || tail[close + 1] !== ".") return undefined;
      return {
        descriptor: { name: name.value, descriptor: "method" },
        next: close + 2,
      };
    }
    default:
      return undefined;
  }
}

/**
 * Read one descriptor name, honouring backtick escaping.
 *
 * Inside backticks a doubled backtick is one literal backtick, which is the
 * escape SCIP defines; without that rule a name containing a backtick ends the
 * quote early and the rest of the symbol parses as garbage.
 */
function readName(
  tail: string,
  start: number,
  closer: string | undefined,
): { value: string; next: number } | undefined {
  if (tail[start] === "`") {
    let value = "";
    let index = start + 1;
    for (;;) {
      const at = tail.indexOf("`", index);
      if (at === -1) return undefined;
      if (tail[at + 1] === "`") {
        value += `${tail.slice(index, at)}\``;
        index = at + 2;
        continue;
      }
      value += tail.slice(index, at);
      return { value, next: at + 1 };
    }
  }
  let index = start;
  while (index < tail.length) {
    const character = tail[index]!;
    if (closer !== undefined ? character === closer : SUFFIXES.has(character)) {
      break;
    }
    index += 1;
  }
  if (index === start) return undefined;
  return { value: tail.slice(start, index), next: index };
}

const SUFFIXES = new Set(["/", "#", ".", ":", "!", "(", ")", "[", "]"]);
