import { TestValidator } from "@nestia/e2e";
import {
  type GraphEdgeKind,
  ScipEnrichment,
  ScipSession,
  graphSnapshotDigests,
  scipProvider,
} from "@samchon/graph";
import fs from "node:fs";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";

/**
 * Language-specific SCIP facts are explicit, versioned, and strictly additive.
 *
 * A bare artifact still owns its navigation skeleton. The language contract may
 * add a fact family only after declaring its precise version, and no enrichment
 * may replace that skeleton or move a published session forward on failure.
 */
export const test_scip_enrichment_is_additive_and_versioned = async () => {
  assertTheAdditiveBoundary();
  await assertTheSessionFence();
};

function assertTheAdditiveBoundary(): void {
  const common = commonSlice();
  TestValidator.equals(
    "no enrichment preserves the common SCIP slice exactly",
    ScipEnrichment.apply({
      index: indexOf(),
      root: "/fixture",
      provider: "scip-fixture",
      languages: ["go"],
      common,
    }),
    { edges: common.edges, warnings: [] },
  );

  let immutable = false;
  let immutableIndex = false;
  const rawIndex = indexOf();
  const calls = enrichment({
    enrich: ({ common: snapshot, index }) => {
      try {
        (snapshot.nodes[0] as { name: string }).name = "rewritten";
      } catch {
        immutable = true;
      }
      try {
        (index.metadata as { projectRoot: string }).projectRoot = "/rewritten";
      } catch {
        immutableIndex = true;
      }
      return {
        edges: [
          { kind: "calls", from: "caller", to: "callee" },
          { kind: "calls", from: "callee", to: "caller" },
        ],
        warnings: ["one limitation", "one limitation", "another limitation"],
      };
    },
  });
  const enriched = ScipEnrichment.apply({
    enrichment: calls,
    index: rawIndex,
    root: "/fixture",
    provider: "scip-fixture",
    languages: ["go"],
    common,
  });
  TestValidator.equals(
    "an enrichment adds only its declared facts in deterministic order",
    [
      enriched.edges.map((edge) => `${edge.kind}:${edge.from}->${edge.to}`),
      enriched.warnings,
      immutable,
      immutableIndex,
      common.nodes[0]!.name,
      rawIndex.metadata.projectRoot,
      Object.isFrozen(rawIndex),
      ScipEnrichment.capability(calls),
    ],
    [
      [
        "references:caller->callee",
        "calls:callee->caller",
        "calls:caller->callee",
      ],
      ["another limitation", "one limitation"],
      true,
      true,
      "caller",
      "/fixture",
      false,
      "scip-enrichment:go-calls@2",
    ],
  );

  const mutable = enrichment();
  const normalized = ScipEnrichment.normalize(mutable, ["go"]);
  (mutable as { name: string }).name = "changed";
  (mutable as { version: number }).version = 9;
  (mutable.languages as unknown as string[])[0] = "rust";
  (mutable.facts as GraphEdgeKind[])[0] = "tests";
  (mutable as { enrich: ScipEnrichment.IContract["enrich"] }).enrich = () => ({
    edges: [{ kind: "tests", from: "caller", to: "callee" }],
  });
  TestValidator.equals(
    "a normalized contract cannot drift after provider registration",
    [
      normalized.name,
      normalized.version,
      normalized.languages,
      normalized.facts,
      ScipEnrichment.apply({
        enrichment: normalized,
        index: indexOf(),
        root: "/fixture",
        provider: "scip-fixture",
        languages: ["go"],
        common,
      }).edges,
      Object.isFrozen(normalized),
      Object.isFrozen(normalized.languages),
      Object.isFrozen(normalized.facts),
    ],
    [
      "go-calls",
      2,
      ["go"],
      ["calls"],
      common.edges,
      true,
      true,
      true,
    ],
  );

  TestValidator.predicate(
    "the bare common slice cannot smuggle in a language-owned fact",
    throws(() =>
      apply(
        {
          ...common,
          edges: [
            ...common.edges,
            { kind: "calls", from: "caller", to: "callee" },
          ],
        },
        calls,
      ),
    ),
  );

  for (const [label, candidate] of [
    ["an invalid enrichment name", { ...calls, name: "Go calls" }],
    ["a non-positive enrichment version", { ...calls, version: 0 }],
    ["a mismatched enrichment language slice", { ...calls, languages: ["rust"] }],
    ["a duplicate enrichment language slice", { ...calls, languages: ["go", "go"] }],
    ["an empty enrichment fact declaration", { ...calls, facts: [] }],
    ["a duplicate enrichment fact declaration", { ...calls, facts: ["calls", "calls"] }],
    [
      "a missing enrichment implementation",
      {
        ...calls,
        enrich: undefined as unknown as ScipEnrichment.IContract["enrich"],
      },
    ],
    [
      "an unknown enrichment fact declaration",
      {
        ...calls,
        facts: ["not-a-graph-fact" as GraphEdgeKind],
      },
    ],
    ["an attempted common-fact replacement", { ...calls, facts: ["references"] }],
  ] as const) {
    TestValidator.predicate(label, throws(() => ScipEnrichment.assert(candidate, ["go"])));
  }

  TestValidator.predicate(
    "the common SCIP slice cannot duplicate a node",
    throws(() =>
      apply(
        {
          ...common,
          nodes: [...common.nodes, { ...common.nodes[0]! }],
        },
        calls,
      ),
    ),
  );
  TestValidator.predicate(
    "the common SCIP slice cannot duplicate a file",
    throws(() =>
      apply(
        {
          ...common,
          files: [...common.files, common.files[0]!],
        },
        calls,
      ),
    ),
  );
  TestValidator.predicate(
    "the common SCIP slice cannot duplicate an edge",
    throws(() =>
      apply(
        {
          ...common,
          edges: [...common.edges, { ...common.edges[0]! }],
        },
        calls,
      ),
    ),
  );
  TestValidator.predicate(
    "the common SCIP slice cannot publish an absent endpoint",
    throws(() =>
      apply(
        {
          ...common,
          edges: [
            { kind: "references", from: "caller", to: "missing" },
          ],
        },
        calls,
      ),
    ),
  );
  TestValidator.predicate(
    "the common SCIP slice cannot publish from an absent endpoint",
    throws(() =>
      apply(
        {
          ...common,
          edges: [
            { kind: "references", from: "missing", to: "callee" },
          ],
        },
        calls,
      ),
    ),
  );
  TestValidator.equals(
    "common file containers remain valid edge endpoints",
    apply(
      {
        ...common,
        edges: [
          { kind: "contains", from: "src/main.go", to: "caller" },
          { kind: "references", from: "caller", to: "src/main.go" },
        ],
      },
      enrichment(),
    ).edges,
    [
      { kind: "contains", from: "src/main.go", to: "caller" },
      { kind: "references", from: "caller", to: "src/main.go" },
    ],
  );
  TestValidator.predicate(
    "an enrichment cannot publish a fact it did not declare",
    throws(() =>
      apply(common, enrichment({ facts: ["tests"], enrich: () => ({
        edges: [{ kind: "calls", from: "caller", to: "callee" }],
      }) })),
    ),
  );
  TestValidator.predicate(
    "an enrichment cannot publish an endpoint outside the common slice",
    throws(() =>
      apply(common, enrichment({ enrich: () => ({
        edges: [{ kind: "calls", from: "caller", to: "missing" }],
      }) })),
    ),
  );
  TestValidator.predicate(
    "an enrichment cannot publish from an endpoint outside the common slice",
    throws(() =>
      apply(
        common,
        enrichment({
          enrich: () => ({
            edges: [{ kind: "calls", from: "missing", to: "callee" }],
          }),
        }),
      ),
    ),
  );
  TestValidator.predicate(
    "an enrichment cannot publish one language fact twice",
    throws(() =>
      apply(common, enrichment({ enrich: () => ({
        edges: [
          { kind: "calls", from: "caller", to: "callee" },
          { kind: "calls", from: "caller", to: "callee" },
        ],
      }) })),
    ),
  );
  TestValidator.predicate(
    "a non-object enrichment edge cannot enter a graph",
    throws(() =>
      apply(
        common,
        enrichment({
          enrich: () =>
            ({
              edges: [null],
            }) as unknown as ScipEnrichment.IResult,
        }),
      ),
    ),
  );
  TestValidator.predicate(
    "a null enrichment result cannot enter a graph",
    throws(() =>
      apply(
        common,
        enrichment({
          enrich: () => null as unknown as ScipEnrichment.IResult,
        }),
      ),
    ),
  );
  TestValidator.predicate(
    "a malformed enrichment result cannot enter a graph",
    throws(() =>
      apply(
        common,
        enrichment({
          enrich: () => ({ edges: undefined } as unknown as ScipEnrichment.IResult),
        }),
      ),
    ),
  );
  TestValidator.predicate(
    "non-array warnings cannot enter a graph",
    throws(() =>
      apply(
        common,
        enrichment({
          enrich: () =>
            ({
              edges: [],
              warnings: "not an array",
            }) as unknown as ScipEnrichment.IResult,
        }),
      ),
    ),
  );
  TestValidator.predicate(
    "empty enrichment warnings cannot enter a graph",
    throws(() =>
      apply(
        common,
        enrichment({ enrich: () => ({ edges: [], warnings: [""] }) }),
      ),
    ),
  );
  TestValidator.predicate(
    "whitespace-only enrichment warnings cannot enter a graph",
    throws(() =>
      apply(
        common,
        enrichment({ enrich: () => ({ edges: [], warnings: ["   "] }) }),
      ),
    ),
  );
}

async function assertTheSessionFence(): Promise<void> {
  const root = GraphPaths.createTempDirectory("samchon-graph-scip-enrichment-");
  const source = path.join(root, "main.go");
  fs.writeFileSync(source, "package main\n");
  let calls = 0;
  const contract = enrichment({
    enrich: ({ common }) => {
      calls += 1;
      return {
        edges:
          calls === 1
            ? [{ kind: "calls", from: common.nodes[0]!.id, to: common.nodes[0]!.id }]
            : [{ kind: "calls", from: common.nodes[0]!.id, to: "missing" }],
      };
    },
  });
  const session = sessionOf(root, contract);
  const first = await session.refresh();
  TestValidator.equals(
    "a session publishes its versioned enrichment beside common facts",
    [
      first.snapshot.provenance.facts,
      first.snapshot.provenance.capabilities.includes(
        "scip-enrichment:go-calls@2",
      ),
      first.snapshot.edges.map((edge) => edge.kind),
    ],
    [["contains", "references", "type_ref", "calls"], true, ["calls"]],
  );
  fs.appendFileSync(source, "// force a new candidate\n");
  await rejects(session.refresh());
  TestValidator.equals(
    "a failed enrichment leaves the prior whole generation standing",
    [session.generation, session.current],
    [1, first.snapshot],
  );
  await session.close();

  let externallyValidated = false;
  const sourceBacked = sessionOf(
    root,
    enrichment({
      enrich: ({ common }) => ({
        edges: [
          { kind: "calls", from: common.nodes[0]!.id, to: common.nodes[0]!.id },
        ],
      }),
    }),
    true,
    () => {
      externallyValidated = true;
    },
  );
  const sourceBackedRefresh = await sourceBacked.refresh();
  TestValidator.predicate(
    "a source-backed enrichment retains both source and contract capabilities",
    sourceBackedRefresh.snapshot.provenance.capabilities.includes(
      "sourceDigests",
    ) &&
      sourceBackedRefresh.snapshot.provenance.capabilities.includes(
        "scip-enrichment:go-calls@2",
      ) &&
      externallyValidated,
  );
  TestValidator.notEquals(
    "the full snapshot digest includes every observable enrichment envelope field",
    graphSnapshotDigests.snapshotOf(sourceBackedRefresh.snapshot),
    graphSnapshotDigests.snapshotOf({
      ...sourceBackedRefresh.snapshot,
      warnings: ["a different observable warning"],
    }),
  );
  await sourceBacked.close();

  const malformed = sessionOf(
    root,
    enrichment({
      enrich: ({ common }) => ({
        edges: [
          {
            kind: "calls",
            from: common.nodes[0]!.id,
            to: common.nodes[0]!.id,
            evidence: {
              file: "main.go",
              startLine: 0,
              startCol: 0,
            },
          },
        ],
      }),
    }),
  );
  await rejects(malformed.refresh());
  TestValidator.equals(
    "a direct SCIP session validates enrichment before publication",
    [malformed.generation, malformed.current],
    [0, undefined],
  );
  await malformed.close();

  const provider = scipProvider({
    name: "scip-enriched-fixture",
    languages: ["go"],
    resolve: () => ({ command: process.execPath, args: [] }),
    decode: () => ({ command: process.execPath, args: [] }),
    indexArgs: () => [],
    inputs: () => [],
    languageOf: () => "go",
    enrichment: contract,
  });
  TestValidator.equals(
    "a registry entry declares exactly the common and enriched fact families",
    provider.facts,
    ["contains", "references", "type_ref", "calls"],
  );
  await provider
    .open({
      root,
      command: { command: process.execPath, args: [] },
      languages: ["go"],
      options: {},
    })
    .close();
  const bareProvider = scipProvider({
    name: "scip-bare-fixture",
    languages: ["go"],
    resolve: () => ({ command: process.execPath, args: [] }),
    decode: () => ({ command: process.execPath, args: [] }),
    indexArgs: () => [],
    inputs: () => [],
    languageOf: () => "go",
  });
  TestValidator.equals(
    "a registry entry without enrichment retains only bare SCIP facts",
    bareProvider.facts,
    ["contains", "references", "type_ref"],
  );
  await bareProvider
    .open({
      root,
      command: { command: process.execPath, args: [] },
      languages: ["go"],
      options: {},
    })
    .close();
}

function apply(
  common: ReturnType<typeof commonSlice>,
  enrichment: ScipEnrichment.IContract,
): ScipEnrichment.IApplyResult {
  return ScipEnrichment.apply({
    enrichment,
    index: indexOf(),
    root: "/fixture",
    provider: "scip-fixture",
    languages: ["go"],
    common,
  });
}

function commonSlice() {
  return {
    nodes: [
      {
        id: "caller",
        kind: "function" as const,
        language: "go" as const,
        name: "caller",
        file: "src/main.go",
        external: false,
      },
      {
        id: "callee",
        kind: "function" as const,
        language: "go" as const,
        name: "callee",
        file: "src/main.go",
        external: false,
      },
    ],
    edges: [
      {
        kind: "references" as const,
        from: "caller",
        to: "callee",
      },
    ],
    diagnostics: [],
    warnings: [],
    files: ["src/main.go"],
  };
}

function indexOf() {
  return {
    metadata: { projectRoot: "/fixture" },
    documents: [],
  };
}

function enrichment(
  override: Partial<ScipEnrichment.IContract> = {},
): ScipEnrichment.IContract {
  return {
    name: "go-calls",
    version: 2,
    languages: ["go"],
    facts: ["calls"],
    enrich: () => ({ edges: [] }),
    ...override,
  };
}

function sessionOf(
  root: string,
  enrichment: ScipEnrichment.IContract,
  sourceText: boolean = false,
  validate?: ScipSession.IOptions["validate"],
): ScipSession {
  return new ScipSession({
    root,
    languages: ["go"],
    provider: "scip-enrichment-fixture",
    authority: "semantic-index",
    command: {
      command: process.execPath,
      args: [GraphPaths.fakeScipIndexer],
    },
    decode: {
      command: process.execPath,
      args: [GraphPaths.fakeScipDecoder],
    },
    indexArgs: (artifact) => [
      `--output=${artifact}`,
      `--root=${root}`,
      ...(sourceText ? ["--with-text"] : []),
    ],
    inputs: () => ["main.go"],
    languageOf: () => "go",
    enrichment,
    ...(sourceText ? { sourceText: true } : {}),
    ...(validate === undefined ? {} : { validate }),
  });
}

async function rejects(task: Promise<unknown>): Promise<void> {
  let failed = false;
  try {
    await task;
  } catch {
    failed = true;
  }
  TestValidator.predicate("the candidate rejects", failed);
}

function throws(task: () => unknown): boolean {
  try {
    task();
    return false;
  } catch {
    return true;
  }
}
