import { TestValidator } from "@nestia/e2e";
import {
  adaptScipIndex,
  parseScipIndex,
  scipNodeKind,
  scipSymbol,
  SCIP_EDGE_KINDS,
  type IScipIndex,
} from "@samchon/graph";

/**
 * SCIP ingestion publishes what the index proves and refuses to guess the
 * rest.
 *
 * A SCIP index says where a symbol is defined, referenced, read, and written,
 * and which symbols it implements or is typed by. It has no universal way to
 * say that a reference is an invocation, that a type reference is a
 * construction, or what an annotation means — those are different facts in
 * different languages. The temptation is to recover them by looking at the
 * source around the occurrence, and the whole value of a compiler-owned lane
 * is that it does not.
 */
export const test_scip_ingestion_maps_only_what_it_proves = async () => {
  assertSymbolParsing();
  assertIndexValidation();
  assertMapping();
};

function assertSymbolParsing(): void {
  const method = scipSymbol("scip-go gomod example v1 `pkg`/Server#Serve().");
  TestValidator.equals(
    "a method symbol names itself and its owners",
    [method?.displayName, method?.owners, method?.descriptor, method?.stability],
    ["Serve", ["pkg", "Server"], "method", "persistent"],
  );

  TestValidator.equals(
    "a term descriptor is read",
    scipSymbol("scip-go gomod example v1 `pkg`/value.")?.descriptor,
    "term",
  );
  TestValidator.equals(
    "a type descriptor is read",
    scipSymbol("scip-go gomod example v1 `pkg`/Server#")?.descriptor,
    "type",
  );
  TestValidator.equals(
    "a namespace descriptor is read",
    scipSymbol("scip-go gomod example v1 `pkg`/")?.descriptor,
    "namespace",
  );
  TestValidator.equals(
    "a macro descriptor is read",
    scipSymbol("scip-rust cargo example v1 `krate`/expand!")?.descriptor,
    "macro",
  );
  TestValidator.equals(
    "a meta descriptor is read",
    scipSymbol("scip-java maven example v1 `pkg`/Meta:")?.descriptor,
    "meta",
  );
  TestValidator.equals(
    "a type parameter is read",
    scipSymbol("scip-java maven example v1 `pkg`/Box#[T]")?.descriptor,
    "type-parameter",
  );
  TestValidator.equals(
    "a value parameter is read",
    scipSymbol("scip-java maven example v1 `pkg`/run().(arg)")?.descriptor,
    "parameter",
  );

  // A backticked name may contain the very characters that end a descriptor;
  // cutting at the first `#` would split the name in half.
  TestValidator.equals(
    "a backticked name keeps its punctuation",
    scipSymbol("scip-scala maven example v1 `odd#name`#")?.displayName,
    "odd#name",
  );
  TestValidator.equals(
    "a doubled backtick is one literal backtick",
    scipSymbol("scip-scala maven example v1 ``tick``tock``#")?.displayName,
    "tick`tock",
  );

  // `local N` is an index-local counter: the same declaration is `local 3`
  // today and `local 7` after an edit above it, so it is never persistent.
  TestValidator.equals(
    "a local symbol is scoped to its generation",
    [scipSymbol("local 4")?.stability, scipSymbol("local 4")?.displayName],
    ["generation", "4"],
  );

  for (const malformed of [
    "",
    "local ",
    "scip-go gomod example",
    "scip-go gomod example v1 ",
    "scip-go gomod example v1 `pkg`/unterminated",
    "scip-go gomod example v1 `unclosed",
    "scip-go gomod example v1 `pkg`/run(unclosed.",
  ]) {
    TestValidator.equals(
      `an unreadable symbol is not guessed: "${malformed}"`,
      scipSymbol(malformed),
      undefined,
    );
  }

  // The index's own kind wins; the descriptor is the fallback; neither
  // mapping means no node, because a guessed kind is read as fact downstream.
  TestValidator.equals(
    "the index's kind wins over the descriptor",
    scipNodeKind("Interface", "type"),
    "interface",
  );
  TestValidator.equals(
    "the descriptor is the fallback",
    scipNodeKind(undefined, "method"),
    "method",
  );
  TestValidator.equals(
    "an unmapped kind falls back to the descriptor",
    scipNodeKind("SelfParameterButNotReally", "type"),
    "class",
  );
  TestValidator.equals(
    "a namespace descriptor maps",
    scipNodeKind(undefined, "namespace"),
    "namespace",
  );
  TestValidator.equals(
    "a term descriptor maps",
    scipNodeKind(undefined, "term"),
    "variable",
  );
  TestValidator.equals(
    "a macro descriptor maps",
    scipNodeKind(undefined, "macro"),
    "function",
  );
  for (const undecided of ["type-parameter", "parameter", "meta"] as const) {
    TestValidator.equals(
      `a ${undecided} descriptor declares nothing this graph models`,
      scipNodeKind(undefined, undecided),
      undefined,
    );
  }
  TestValidator.equals(
    "no kind and no descriptor is no node",
    scipNodeKind(undefined, undefined),
    undefined,
  );
}

function assertIndexValidation(): void {
  const valid = parseScipIndex(rawIndex());
  TestValidator.equals(
    "a valid index parses",
    valid.documents.map((document) => document.relativePath),
    ["main.go"],
  );

  // Every rejection below is a shape that, if accepted, would attribute facts
  // to source that never produced them.
  const rejections: Array<[string, unknown]> = [
    ["a non-object index", []],
    ["a missing metadata block", { documents: [] }],
    ["a missing project root", { metadata: {}, documents: [] }],
    ["non-array documents", { metadata: { projectRoot: "file:///r" }, documents: {} }],
    ["an empty document path", withDocument({ relativePath: "" })],
    ["an absolute POSIX document path", withDocument({ relativePath: "/etc/passwd" })],
    ["an absolute Windows document path", withDocument({ relativePath: "C:/x.go" })],
    ["a parent-escaping document path", withDocument({ relativePath: "../out.go" })],
    [
      "two documents describing one file",
      {
        metadata: { projectRoot: "file:///r" },
        documents: [{ relativePath: "a.go" }, { relativePath: "a.go" }],
      },
    ],
    ["an empty occurrence symbol", withOccurrence({ range: [0, 0, 1], symbol: "" })],
    ["a two-element range", withOccurrence({ range: [0, 1], symbol: "s" })],
    ["a five-element range", withOccurrence({ range: [0, 1, 2, 3, 4], symbol: "s" })],
    ["a negative range value", withOccurrence({ range: [0, -1, 2], symbol: "s" })],
    ["a fractional range value", withOccurrence({ range: [0, 1.5, 2], symbol: "s" })],
    ["a range that ends before it starts", withOccurrence({ range: [3, 0, 1, 0], symbol: "s" })],
    [
      "a single-line range that ends before it starts",
      withOccurrence({ range: [0, 5, 2], symbol: "s" }),
    ],
    [
      "a non-integer role mask",
      withOccurrence({ range: [0, 0, 1], symbol: "s", symbolRoles: "1" }),
    ],
    [
      "a negative role mask",
      withOccurrence({ range: [0, 0, 1], symbol: "s", symbolRoles: -1 }),
    ],
    ["an empty symbol identity", withSymbol({ symbol: "" })],
    ["a non-string display name", withSymbol({ symbol: "s", displayName: 1 })],
    [
      "a non-boolean relationship flag",
      withSymbol({ symbol: "s", relationships: [{ symbol: "t", isImplementation: "yes" }] }),
    ],
    [
      "a relationship without a symbol",
      withSymbol({ symbol: "s", relationships: [{}] }),
    ],
    [
      "a diagnostic without a message",
      {
        metadata: { projectRoot: "file:///r" },
        documents: [{ relativePath: "a.go", diagnostics: [{ severity: "Error" }] }],
      },
    ],
    [
      "a tool info block without a name",
      { metadata: { projectRoot: "file:///r", toolInfo: {} }, documents: [] },
    ],
    [
      "non-array external symbols",
      { metadata: { projectRoot: "file:///r" }, documents: [], externalSymbols: {} },
    ],
  ];
  for (const [label, malformed] of rejections) {
    TestValidator.error(`a malformed index is refused: ${label}`, () =>
      parseScipIndex(malformed),
    );
  }

  // A single-line three-element range is the shorthand, not a defect.
  TestValidator.equals(
    "the single-line range shorthand is accepted",
    parseScipIndex(withOccurrence({ range: [4, 2, 9], symbol: "s" })).documents[0]!
      .occurrences![0]!.range,
    [4, 2, 9],
  );
  TestValidator.equals(
    "an optional tool info block is kept",
    parseScipIndex({
      metadata: { projectRoot: "file:///r", toolInfo: { name: "scip-go", version: "1" } },
      documents: [],
    }).metadata.toolInfo,
    { name: "scip-go", version: "1" },
  );
}

function assertMapping(): void {
  const adapted = adaptScipIndex({
    index: parseScipIndex(rawIndex()),
    root: "/r",
    provider: "scip-go",
    languages: ["go"],
    languageOf: () => "go",
  });

  TestValidator.equals(
    "declarations become nodes",
    adapted.nodes.map((node) => node.name).sort(),
    ["Serve", "Server", "helper"],
  );
  TestValidator.equals(
    "the document is in the manifest",
    adapted.files,
    ["main.go"],
  );

  const id = (name: string): string =>
    adapted.nodes.find((node) => node.name === name)!.id;

  TestValidator.predicate(
    "a reference inside a definition is attributed to it",
    adapted.edges.some(
      (edge) =>
        edge.kind === "references" &&
        edge.from === id("Serve") &&
        edge.to === id("helper"),
    ),
  );
  TestValidator.predicate(
    "a read role becomes an access, not a bare reference",
    adapted.edges.some(
      (edge) =>
        edge.kind === "accesses" &&
        edge.from === id("Serve") &&
        edge.to === id("Server"),
    ),
  );
  TestValidator.predicate(
    "an enclosing symbol becomes containment",
    adapted.edges.some(
      (edge) =>
        edge.kind === "contains" &&
        edge.from === id("Server") &&
        edge.to === id("Serve"),
    ),
  );
  TestValidator.predicate(
    "spans are one-based",
    adapted.nodes.every(
      (node) => node.evidence === undefined || node.evidence.startLine >= 1,
    ),
  );

  // The refusal that matters: nothing in a SCIP index says this reference was
  // an invocation, so no `calls` edge is invented for it.
  TestValidator.predicate(
    "no edge family outside SCIP's proof is published",
    adapted.edges.every((edge) => SCIP_EDGE_KINDS.includes(edge.kind)),
  );
  TestValidator.predicate(
    "calls are never inferred",
    !adapted.edges.some((edge) => edge.kind === "calls"),
  );

  // A document in a language this session does not own is reported, not
  // silently absorbed.
  const foreign = adaptScipIndex({
    index: parseScipIndex(rawIndex()),
    root: "/r",
    provider: "scip-go",
    languages: ["go"],
    languageOf: () => "rust",
  });
  TestValidator.equals("a foreign document contributes nothing", foreign.nodes, []);
  TestValidator.predicate(
    "a foreign document is reported",
    foreign.warnings.some((warning) => warning.includes("does not own")),
  );
}

function rawIndex(): unknown {
  const server = "scip-go gomod example v1 `main`/Server#";
  const serve = "scip-go gomod example v1 `main`/Server#Serve().";
  const helper = "scip-go gomod example v1 `main`/helper().";
  return {
    metadata: {
      projectRoot: "file:///r",
      toolInfo: { name: "scip-go", version: "0.1.0" },
    },
    documents: [
      {
        language: "Go",
        relativePath: "main.go",
        symbols: [
          { symbol: server, displayName: "Server", kind: "Struct" },
          {
            symbol: serve,
            displayName: "Serve",
            kind: "Method",
            enclosingSymbol: server,
          },
          { symbol: helper, displayName: "helper", kind: "Function" },
        ],
        occurrences: [
          { range: [0, 5, 11], symbol: server, symbolRoles: 1 },
          {
            range: [2, 10, 15],
            symbol: serve,
            symbolRoles: 1,
            enclosingRange: [2, 0, 8, 1],
          },
          { range: [4, 2, 8], symbol: helper },
          { range: [5, 2, 8], symbol: server, symbolRoles: 8 },
          { range: [9, 0, 6], symbol: helper, symbolRoles: 1 },
        ],
      },
    ],
  };
}

function withDocument(document: Record<string, unknown>): unknown {
  return { metadata: { projectRoot: "file:///r" }, documents: [document] };
}

function withOccurrence(occurrence: Record<string, unknown>): unknown {
  return withDocument({ relativePath: "a.go", occurrences: [occurrence] });
}

function withSymbol(symbol: Record<string, unknown>): unknown {
  return withDocument({ relativePath: "a.go", symbols: [symbol] });
}
