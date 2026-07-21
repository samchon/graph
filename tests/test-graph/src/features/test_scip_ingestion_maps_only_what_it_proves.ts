import { TestValidator } from "@nestia/e2e";
import {
  adaptScipIndex,
  parseScipIndex,
  scipSymbol,
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
    scipSymbol("scip-scala maven example v1 `tick``tock`#")?.displayName,
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
    // A suffix that closes a descriptor it never opened denotes nothing.
    "scip-go gomod example v1 `pkg`/bad)",
    "scip-go gomod example v1 `pkg`/bad]",
    // A bracketed descriptor with nothing inside it names nothing.
    "scip-java maven example v1 `pkg`/Box#[]",
    "scip-java maven example v1 `pkg`/run().()",
    // A descriptor that is only a suffix has no name to read.
    "scip-go gomod example v1 #",
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
    scipSymbol.nodeKind("Interface", "type"),
    "interface",
  );
  TestValidator.equals(
    "the descriptor is the fallback",
    scipSymbol.nodeKind(undefined, "method"),
    "method",
  );
  TestValidator.equals(
    "an unmapped kind falls back to the descriptor",
    scipSymbol.nodeKind("SelfParameterButNotReally", "type"),
    "class",
  );
  TestValidator.equals(
    "a namespace descriptor maps",
    scipSymbol.nodeKind(undefined, "namespace"),
    "namespace",
  );
  TestValidator.equals(
    "a term descriptor maps",
    scipSymbol.nodeKind(undefined, "term"),
    "variable",
  );
  TestValidator.equals(
    "a macro descriptor maps",
    scipSymbol.nodeKind(undefined, "macro"),
    "function",
  );
  for (const undecided of ["type-parameter", "parameter", "meta"] as const) {
    TestValidator.equals(
      `a ${undecided} descriptor declares nothing this graph models`,
      scipSymbol.nodeKind(undefined, undecided),
      undefined,
    );
  }
  TestValidator.equals(
    "no kind and no descriptor is no node",
    scipSymbol.nodeKind(undefined, undefined),
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
  // Optional records the graph does not read are still validated, because a
  // malformed one is evidence the index was not produced the way it claims.
  const documented = parseScipIndex(
    withSymbol({
      symbol: "scip-go gomod example v1 `pkg`/run().",
      documentation: ["one", "two"],
      relationships: [{ symbol: "scip-go gomod example v1 `pkg`/Other#" }],
      enclosingSymbol: "scip-go gomod example v1 `pkg`/Owner#",
    }),
  ).documents[0]!.symbols![0]!;
  TestValidator.equals(
    "documentation lines are carried",
    documented.documentation,
    ["one", "two"],
  );
  TestValidator.equals(
    "a relationship with no flags set carries none",
    documented.relationships,
    [{ symbol: "scip-go gomod example v1 `pkg`/Other#" }],
  );
  TestValidator.error("a non-string documentation line is refused", () =>
    parseScipIndex(withSymbol({ symbol: "s", documentation: [1] })),
  );
  TestValidator.error("non-array documentation is refused", () =>
    parseScipIndex(withSymbol({ symbol: "s", documentation: "one" })),
  );
  TestValidator.error("non-array relationships are refused", () =>
    parseScipIndex(withSymbol({ symbol: "s", relationships: {} })),
  );
  TestValidator.error("a non-string enclosing symbol is refused", () =>
    parseScipIndex(withSymbol({ symbol: "s", enclosingSymbol: 1 })),
  );
  TestValidator.error("a non-string position encoding is refused", () =>
    parseScipIndex(withDocument({ relativePath: "a.go", positionEncoding: 1 })),
  );
  TestValidator.error("a non-string syntax kind is refused", () =>
    parseScipIndex(
      withOccurrence({ range: [0, 0, 1], symbol: "s", syntaxKind: 1 }),
    ),
  );
  TestValidator.error("a malformed enclosing range is refused", () =>
    parseScipIndex(
      withOccurrence({ range: [0, 0, 1], symbol: "s", enclosingRange: [0, 0] }),
    ),
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
    adapted.edges.every((edge) => adaptScipIndex.EDGE_KINDS.includes(edge.kind)),
  );
  TestValidator.predicate(
    "calls are never inferred",
    !adapted.edges.some((edge) => edge.kind === "calls"),
  );

  // A range is an offset in code units, and which code unit is the document's
  // to declare. Graph columns are UTF-16, so a UTF-8 indexer disagrees on every
  // line holding a non-ASCII character — silently, and only there.
  const utf8 = adaptScipIndex({
    index: parseScipIndex(rawIndex({ positionEncoding: "UTF8CodeUnitOffsetFromLineStart" })),
    root: "/r",
    provider: "scip-go",
    languages: ["go"],
    languageOf: () => "go",
  });
  TestValidator.predicate(
    "a non-UTF-16 position encoding is reported rather than absorbed",
    utf8.warnings.some((warning) => warning.includes("UTF-16 code units")),
  );
  TestValidator.equals(
    "…and its facts are still published, because spans are evidence not identity",
    utf8.nodes.length,
    adapted.nodes.length,
  );
  // "Did not say" is not "said something wrong": an older indexer that omits
  // the field must not put a warning on every well-behaved ASCII project.
  TestValidator.equals(
    "an absent position encoding is not a warning",
    adapted.warnings.filter((warning) => warning.includes("UTF-16")),
    [],
  );
  TestValidator.equals(
    "an explicitly UTF-16 encoding is not a warning",
    adaptScipIndex({
      index: parseScipIndex(
        rawIndex({ positionEncoding: "UTF16CodeUnitOffsetFromLineStart" }),
      ),
      root: "/r",
      provider: "scip-go",
      languages: ["go"],
      languageOf: () => "go",
    }).warnings.filter((warning) => warning.includes("UTF-16")),
    [],
  );

  assertRelationshipsAndExternals();

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

/**
 * Typed relationships, dependency leaves, diagnostics, and the shapes the
 * adapter drops rather than approximates.
 */
function assertRelationshipsAndExternals(): void {
  const base = "scip-go gomod example v1 `main`";
  const iface = `${base}/Reader#`;
  const impl = `${base}/File#`;
  const typed = `${base}/Handle#`;
  const external = "scip-go gomod dep v1 `dep`/Client#";
  const unnamed = "scip-go gomod dep v1 `dep`/";

  const adapted = adaptScipIndex({
    index: parseScipIndex({
      metadata: { projectRoot: "file:///r" },
      documents: [
        {
          relativePath: "main.go",
          symbols: [
            { symbol: iface, displayName: "Reader", kind: "Interface" },
            {
              symbol: impl,
              displayName: "File",
              kind: "Struct",
              // Both flags on one relationship are two separate claims; a
              // reader that treats the record as a tagged union drops the
              // second.
              relationships: [
                { symbol: iface, isImplementation: true, isTypeDefinition: true },
                // A relationship naming a symbol nothing declares has no
                // endpoint to land on.
                { symbol: "scip-go gomod example v1 `main`/Absent#", isImplementation: true },
                // A self-relationship is not an edge.
                { symbol: impl, isImplementation: true },
              ],
            },
            {
              symbol: typed,
              displayName: "Handle",
              kind: "TypeAlias",
              // An enclosing symbol nothing declares cannot own anything.
              enclosingSymbol: "scip-go gomod example v1 `main`/Missing#",
            },
            // A kind this graph does not model publishes no node, and neither
            // does the type-parameter descriptor it falls back to.
            { symbol: `${base}/T#[X]`, displayName: "X", kind: "SomethingNewer" },
            // A symbol string the parser cannot read is reported, not guessed.
            { symbol: "!!unreadable!!", displayName: "junk", kind: "Function" },
            // A declaration with no name to show.
            { symbol: `${base}/anon.`, displayName: "", kind: "Variable" },
          ],
          occurrences: [
            {
              range: [0, 5, 11],
              symbol: iface,
              symbolRoles: 1,
              // A second scope, so attribution has to rank them: the innermost
              // enclosing definition owns a reference, and with one scope the
              // ranking never runs.
              enclosingRange: [0, 0, 30, 0],
            },
            {
              range: [2, 5, 9],
              symbol: impl,
              symbolRoles: 1,
              enclosingRange: [2, 0, 9, 1],
            },
            {
              range: [3, 4, 10],
              symbol: typed,
              symbolRoles: 1,
              // Starts on the same line its owner does, so containment has to
              // compare columns rather than stopping at the line number.
              enclosingRange: [2, 2, 2, 40],
            },
            // A dependency leaf, created at the moment a document names it and
            // taking that document's language.
            { range: [4, 2, 8], symbol: external },
            // A reference with no enclosing definition has nothing to
            // attribute it to.
            { range: [20, 0, 4], symbol: iface },
            // A write access is an access, not a bare reference.
            { range: [5, 2, 8], symbol: iface, symbolRoles: 4 },
            // An occurrence naming a symbol nothing declares is dropped.
            { range: [6, 0, 4], symbol: `${base}/Nowhere#` },
            // …and one this parser cannot read.
            { range: [7, 0, 4], symbol: "!!unreadable!!" },
          ],
          diagnostics: [
            { severity: "Error", code: "E1", message: "broken" },
            { severity: "Warning", message: "suspicious" },
            { severity: "Information", message: "noted" },
            { severity: "Hint", message: "consider" },
            // An unspecified severity is kept without one rather than
            // defaulted to error.
            { message: "unattributed", source: "vet" },
          ],
        },
      ],
      externalSymbols: [
        { symbol: external, displayName: "Client", kind: "Class" },
        // A dependency leaf nothing ever references is never materialized.
        { symbol: "scip-go gomod dep v1 `dep`/Unused#", displayName: "Unused" },
        // …and one with no name to show cannot be.
        { symbol: unnamed, displayName: "" },
      ],
    }),
    root: "/r",
    provider: "scip-go",
    languages: ["go"],
    languageOf: () => "go",
  });

  const named = (name: string): string | undefined =>
    adapted.nodes.find((node) => node.name === name)?.id;

  TestValidator.equals(
    "only declarations this graph models become nodes",
    adapted.nodes.map((node) => node.name).sort(),
    ["Client", "File", "Handle", "Reader"],
  );
  TestValidator.predicate(
    "a dependency leaf is external and fileless",
    adapted.nodes.some(
      (node) => node.name === "Client" && node.external && node.file === "",
    ),
  );
  TestValidator.predicate(
    "an unreferenced dependency leaf is never materialized",
    !adapted.nodes.some((node) => node.name === "Unused"),
  );
  TestValidator.predicate(
    "an unreadable symbol is reported",
    adapted.warnings.some((warning) => warning.includes("cannot name")),
  );

  const edge = (kind: string, from: string, to: string): boolean =>
    adapted.edges.some(
      (candidate) =>
        candidate.kind === kind &&
        candidate.from === named(from) &&
        candidate.to === named(to),
    );
  TestValidator.predicate(
    "an implementation relationship maps",
    edge("implements", "File", "Reader"),
  );
  TestValidator.predicate(
    "…and a type-definition flag on the same record is its own claim",
    edge("type_ref", "File", "Reader"),
  );
  TestValidator.predicate(
    "a write access is an access",
    edge("accesses", "File", "Reader"),
  );
  TestValidator.predicate(
    "a reference to a dependency leaf lands on it",
    edge("references", "File", "Client"),
  );
  TestValidator.predicate(
    "a relationship to an undeclared symbol emits nothing",
    !adapted.edges.some((candidate) => candidate.to === undefined),
  );
  TestValidator.predicate(
    "an unowned enclosing symbol emits no containment",
    !adapted.edges.some((candidate) => candidate.kind === "contains"),
  );

  TestValidator.equals(
    "every diagnostic severity the index states is carried",
    adapted.diagnostics.map((diagnostic) => diagnostic.severity),
    ["error", "warning", "info", "hint", undefined],
  );
  TestValidator.equals(
    "a diagnostic without a code falls back to its source",
    adapted.diagnostics[4]?.code,
    "vet",
  );

  // One symbol cannot be defined in two documents; keeping the first is
  // reported rather than silently overwriting.
  const duplicated = adaptScipIndex({
    index: parseScipIndex({
      metadata: { projectRoot: "file:///r" },
      documents: ["a.go", "b.go"].map((relativePath) => ({
        relativePath,
        symbols: [{ symbol: iface, displayName: "Reader", kind: "Interface" }],
      })),
    }),
    root: "/r",
    provider: "scip-go",
    languages: ["go"],
    languageOf: () => "go",
  });
  TestValidator.equals(
    "a symbol defined twice keeps one node",
    duplicated.nodes.length,
    1,
  );
  TestValidator.predicate(
    "…and says which definition it kept",
    duplicated.warnings.some((warning) => warning.includes("keeping the first")),
  );
}

function rawIndex(document: Record<string, unknown> = {}): unknown {
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
        ...document,
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
