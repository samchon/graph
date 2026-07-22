import { TestValidator } from "@nestia/e2e";
import {
  GRAPH_PROVIDERS,
  assertGraphSnapshotContract,
  dumpProvenanceOf,
  graphSnapshotDigests,
  selectGraphProviders,
  type IGraphProvider,
  type ISamchonGraphNode,
} from "@samchon/graph";

// `mergeGraphSlices` is the indexer's own merge step, not part of the package
// surface, so it is reached by path like every other internal.
import { mergeGraphSlices } from "../../../../packages/graph/src/provider/mergeGraphSlices";
import { ProviderFixtures } from "../internal/ProviderFixtures";

/**
 * Provider discovery is data, and every decline is a sentence somebody can
 * read.
 *
 * The selection this replaces was an `if (language === "typescript")` arm
 * inside the indexer's language loop, with no `else`. A caller whose options
 * disqualified the compiler-owned lane fell straight through to the generic
 * one and got a success indistinguishable from the strict result it had
 * silently replaced — which is how the real-language experiment ran for months
 * having never once launched the provider it existed to prove.
 */
export const test_provider_registry_selects_one_owner_per_language =
  async () => {
    await assertSelection();
    await assertSnapshotContract();
    await assertCrossProviderCollisions();
    await assertDigestsAndProvenance();
  };

async function assertSelection(): Promise<void> {
  const typescript = ProviderFixtures.provider({
    name: "fake-ts",
    languages: ["typescript"],
  });
  const clang = ProviderFixtures.provider({
    name: "fake-clang",
    languages: ["cpp", "c"],
    authority: "compiler",
  });

  // A provider owns only the languages this build actually selected. A C++
  // slice for a project with no C++ would replace nothing while claiming the
  // language was indexed.
  const partial = selectGraphProviders(
    "/root",
    ["c", "go"],
    {},
    {},
    [typescript, clang],
  );
  TestValidator.equals(
    "only the selected languages are owned",
    partial.candidates.map((candidate) => candidate.languages),
    [["c"]],
  );
  TestValidator.equals(
    "a provider with no selected language is not a candidate",
    partial.candidates.map((candidate) => candidate.provider.name),
    ["fake-clang"],
  );
  TestValidator.equals("nothing declined, nothing said", partial.warnings, []);

  const both = selectGraphProviders(
    "/root",
    ["typescript", "cpp", "c"],
    {},
    {},
    [typescript, clang],
  );
  TestValidator.equals(
    "one provider owns both of its languages at once",
    both.candidates.map((candidate) => candidate.languages),
    [["typescript"], ["cpp", "c"]],
  );

  // --- every decline produces exactly one attributable sentence ----------
  const refused = selectGraphProviders(
    "/root",
    ["typescript"],
    {},
    {},
    [
      ProviderFixtures.provider({
        name: "fake-ts",
        refuse: () => "typescript: this provider has no bounded mode.",
      }),
    ],
  );
  TestValidator.equals("a refusal is not a candidate", refused.candidates, []);
  TestValidator.equals("a refusal is reported verbatim", refused.warnings, [
    "typescript: this provider has no bounded mode.",
  ]);

  const missing = selectGraphProviders(
    "/root",
    ["typescript"],
    {},
    {},
    [ProviderFixtures.provider({ name: "fake-ts", resolve: () => undefined })],
  );
  TestValidator.equals("an absent tool is not a candidate", missing.candidates, []);
  TestValidator.predicate(
    "an absent tool names the provider and its authority",
    missing.warnings.length === 1 &&
      missing.warnings[0]!.includes("fake-ts") &&
      missing.warnings[0]!.includes("compiler"),
  );

  const unprepared = selectGraphProviders(
    "/root",
    ["typescript"],
    {},
    {},
    [
      ProviderFixtures.provider({
        name: "fake-ts",
        prepare: () => {
          throw new Error("no compilation database");
        },
      }),
    ],
  );
  TestValidator.equals(
    "an unprepared project is not a candidate",
    unprepared.candidates,
    [],
  );
  TestValidator.predicate(
    "an unprepared project reports why",
    unprepared.warnings.length === 1 &&
      unprepared.warnings[0]!.includes("no compilation database"),
  );

  let prepared = 0;
  const preparing = selectGraphProviders(
    "/root",
    ["typescript"],
    {},
    {},
    [
      ProviderFixtures.provider({
        name: "fake-ts",
        prepare: () => {
          prepared += 1;
        },
      }),
    ],
  );
  TestValidator.equals("a successful prepare admits the candidate", [
    preparing.candidates.length,
    prepared,
  ], [1, 1]);

  // --- registry defects are static, not machine-dependent -----------------
  TestValidator.error("two providers cannot own one language", () =>
    selectGraphProviders(
      "/root",
      ["typescript"],
      {},
      {},
      [
        ProviderFixtures.provider({ name: "first" }),
        ProviderFixtures.provider({ name: "second" }),
      ],
    ),
  );
  // Detected even though only one of them could ever resolve here, because the
  // registry is malformed whether or not both indexers are installed today.
  TestValidator.error(
    "an overlap is caught even when the second provider cannot resolve",
    () =>
      selectGraphProviders(
        "/root",
        ["typescript"],
        {},
        {},
        [
          ProviderFixtures.provider({ name: "first" }),
          ProviderFixtures.provider({
            name: "second",
            resolve: () => undefined,
          }),
        ],
      ),
  );
  TestValidator.error("a provider owning no language is a defect", () =>
    selectGraphProviders(
      "/root",
      ["typescript"],
      {},
      {},
      [ProviderFixtures.provider({ name: "empty", languages: [] })],
    ),
  );
  TestValidator.error("a provider identity cannot name two entries", () =>
    selectGraphProviders(
      "/root",
      ["typescript", "go"],
      {},
      {},
      [
        ProviderFixtures.provider({
          name: "duplicate",
          languages: ["typescript"],
        }),
        ProviderFixtures.provider({ name: "duplicate", languages: ["go"] }),
      ],
    ),
  );
  TestValidator.error("a provider cannot declare one fact family twice", () =>
    selectGraphProviders(
      "/root",
      ["typescript"],
      {},
      {},
      [
        ProviderFixtures.provider({
          name: "repeated-fact",
          facts: ["calls", "calls"],
        }),
      ],
    ),
  );

  // The shipped registry must satisfy its own rule.
  TestValidator.equals(
    "the shipped registry has one owner per language",
    selectGraphProviders("/root", [], {}, {}, GRAPH_PROVIDERS).candidates,
    [],
  );
  TestValidator.predicate(
    "the shipped registry declares ttscgraph as a compiler provider",
    GRAPH_PROVIDERS.some(
      (provider: IGraphProvider) =>
        provider.name === "ttscgraph" &&
        provider.authority === "compiler" &&
        provider.languages.includes("typescript"),
    ),
  );
}

async function assertSnapshotContract(): Promise<void> {
  const provider = ProviderFixtures.provider({
    name: "fake",
    languages: ["cpp", "c"],
    facts: ["calls"],
  });
  // A candidate may publish fewer languages than it owns: a Clang provider
  // asked for C and C++ can answer with only the translation units it found.
  // That is admitted here and reported by the indexer, not rejected.
  const valid = ProviderFixtures.snapshot({
    languages: ["cpp"],
    provider: "fake",
    facts: ["calls"],
    nodes: [node("a.cpp", "run", "cpp")],
  });
  // Admission is proved by this not throwing; asserting a literal `true`
  // afterwards would read like a check while testing nothing.
  assertGraphSnapshotContract(valid, provider, ["cpp", "c"]);

  TestValidator.error("a slice owning no language is refused", () =>
    assertGraphSnapshotContract(
      ProviderFixtures.snapshot({ languages: [], provider: "fake", facts: ["calls"] }),
      provider,
      ["cpp"],
    ),
  );
  TestValidator.error("a slice for an unowned language is refused", () =>
    assertGraphSnapshotContract(
      ProviderFixtures.snapshot({
        languages: ["c"],
        provider: "fake",
        facts: ["calls"],
      }),
      provider,
      ["cpp"],
    ),
  );
  TestValidator.error("a slice cannot claim one language more than once", () =>
    assertGraphSnapshotContract(
      ProviderFixtures.snapshot({
        languages: ["cpp", "cpp"],
        provider: "fake",
        facts: ["calls"],
      }),
      provider,
      ["cpp"],
    ),
  );
  // A node the slice does not own would be published by this generation and
  // deleted by no later one.
  TestValidator.error("a node outside the slice's languages is refused", () =>
    assertGraphSnapshotContract(
      ProviderFixtures.snapshot({
        languages: ["cpp"],
        provider: "fake",
        facts: ["calls"],
        nodes: [node("a.c", "run", "c")],
      }),
      provider,
      ["cpp", "c"],
    ),
  );
  TestValidator.error("an unclaimed edge family is refused", () =>
    assertGraphSnapshotContract(
      ProviderFixtures.snapshot({
        languages: ["cpp"],
        provider: "fake",
        facts: ["calls"],
        edges: [{ kind: "decorates", from: "a", to: "b" }],
      }),
      provider,
      ["cpp"],
    ),
  );
  TestValidator.error("provenance naming another provider is refused", () =>
    assertGraphSnapshotContract(
      ProviderFixtures.snapshot({
        languages: ["cpp"],
        provider: "somebody-else",
        facts: ["calls"],
      }),
      provider,
      ["cpp"],
    ),
  );
  TestValidator.error("an overstated authority is refused", () =>
    assertGraphSnapshotContract(
      ProviderFixtures.snapshot({
        languages: ["cpp"],
        provider: "fake",
        authority: "heuristic",
        facts: ["calls"],
      }),
      provider,
      ["cpp"],
    ),
  );
  TestValidator.error("overstated fact families are refused", () =>
    assertGraphSnapshotContract(
      ProviderFixtures.snapshot({
        languages: ["cpp"],
        provider: "fake",
        facts: ["calls", "imports"],
      }),
      provider,
      ["cpp"],
    ),
  );
  TestValidator.error("understated fact families are refused", () =>
    assertGraphSnapshotContract(
      ProviderFixtures.snapshot({
        languages: ["cpp"],
        provider: "fake",
        facts: [],
      }),
      provider,
      ["cpp"],
    ),
  );
  TestValidator.error("a same-sized but different fact set is refused", () =>
    assertGraphSnapshotContract(
      ProviderFixtures.snapshot({
        languages: ["cpp"],
        provider: "fake",
        facts: ["imports"],
      }),
      provider,
      ["cpp"],
    ),
  );
  const twoFamilyProvider = ProviderFixtures.provider({
    name: "two-family",
    languages: ["cpp"],
    facts: ["calls", "imports"],
  });
  TestValidator.error(
    "a duplicate provenance family cannot hide one the provider declared",
    () =>
      assertGraphSnapshotContract(
        ProviderFixtures.snapshot({
          languages: ["cpp"],
          provider: "two-family",
          facts: ["calls", "calls"],
        }),
        twoFamilyProvider,
        ["cpp"],
      ),
  );
}

/**
 * The strict lane now carries several providers' slices at once.
 *
 * That makes a duplicate ambiguous in a way it was not when one provider
 * produced everything, and the two meanings need different answers — a reader
 * told only "duplicated node" for a cross-provider collision will look for the
 * bug inside one provider and never find it.
 */
async function assertCrossProviderCollisions(): Promise<void> {
  const shared = (language: ISamchonGraphNode["language"]) => ({
    ...node("shared.h", "run", language),
    id: "shared.h#run",
  });

  TestValidator.error("one provider publishing an id twice is refused", () =>
    mergeGraphSlices({
      root: "/r",
      files: [],
      genericNodes: [],
      genericEdges: [],
      strictNodes: [shared("cpp"), shared("cpp")],
      strictEdges: [],
    }),
  );

  let message = "";
  try {
    mergeGraphSlices({
      root: "/r",
      files: [],
      genericNodes: [],
      genericEdges: [],
      strictNodes: [shared("c"), shared("cpp")],
      strictEdges: [],
    });
  } catch (error) {
    message = (error as Error).message;
  }
  TestValidator.predicate(
    "two providers publishing one id name both languages",
    message.includes("c and cpp") && message.includes("two owners"),
  );

  // The other half of the same decision: endpoint closure is checked across
  // the strict facts as a whole, because a provider owning C and C++ resolves
  // calls that cross between them — and publishing those is what a shared
  // compilation universe is for.
  const merged = mergeGraphSlices({
    root: "/r",
    files: [],
    genericNodes: [],
    genericEdges: [],
    strictNodes: [
      { ...node("a.c", "caller", "c"), id: "a.c#caller" },
      { ...node("b.cpp", "callee", "cpp"), id: "b.cpp#callee" },
    ],
    strictEdges: [{ kind: "calls", from: "a.c#caller", to: "b.cpp#callee" }],
  });
  TestValidator.equals(
    "a cross-language edge inside one universe survives the merge",
    merged.edges.length,
    1,
  );
}

async function assertDigestsAndProvenance(): Promise<void> {
  const base = ProviderFixtures.snapshot({
    nodes: [node("a.ts", "run", "typescript")],
    edges: [],
    sources: new Map([
      ["a.ts", { checkerDigest: "aaa", diskDigest: "bbb" }],
      ["b.ts", { checkerDigest: "ccc", diskDigest: "ddd" }],
    ]),
  });

  TestValidator.equals(
    "the same slice digests the same twice",
    [
      graphSnapshotDigests.contentOf(base),
      graphSnapshotDigests.manifestOf(base),
    ],
    [
      graphSnapshotDigests.contentOf(base),
      graphSnapshotDigests.manifestOf(base),
    ],
  );

  // Manifest order is not part of the manifest: two providers listing the same
  // files in different orders describe the same program.
  const reordered = ProviderFixtures.snapshot({
    nodes: base.nodes,
    sources: new Map([
      ["b.ts", { checkerDigest: "ccc", diskDigest: "ddd" }],
      ["a.ts", { checkerDigest: "aaa", diskDigest: "bbb" }],
    ]),
  });
  TestValidator.equals(
    "manifest order does not change the manifest digest",
    graphSnapshotDigests.manifestOf(reordered),
    graphSnapshotDigests.manifestOf(base),
  );
  TestValidator.notEquals(
    "a changed checker digest changes the manifest digest",
    graphSnapshotDigests.manifestOf(
      ProviderFixtures.snapshot({
        nodes: base.nodes,
        sources: new Map([["a.ts", { checkerDigest: "zzz", diskDigest: "bbb" }]]),
      }),
    ),
    graphSnapshotDigests.manifestOf(base),
  );

  // Publication order IS part of the content, because the dump's contract is
  // that an unchanged checkout produces byte-identical output.
  TestValidator.notEquals(
    "reordering published nodes changes the content digest",
    graphSnapshotDigests.contentOf(
      ProviderFixtures.snapshot({
        nodes: [node("b.ts", "other", "typescript"), node("a.ts", "run", "typescript")],
      }),
    ),
    graphSnapshotDigests.contentOf(
      ProviderFixtures.snapshot({
        nodes: [node("a.ts", "run", "typescript"), node("b.ts", "other", "typescript")],
      }),
    ),
  );
  TestValidator.notEquals(
    "an added edge changes the content digest",
    graphSnapshotDigests.contentOf(
      ProviderFixtures.snapshot({
        nodes: base.nodes,
        edges: [
          {
            kind: "calls",
            from: base.nodes[0]!.id,
            to: base.nodes[0]!.id,
            evidence: { file: "a.ts", startLine: 2, startCol: 3 },
          },
        ],
      }),
    ),
    graphSnapshotDigests.contentOf(base),
  );
  TestValidator.notEquals(
    "an added diagnostic changes the content digest",
    graphSnapshotDigests.contentOf(
      ProviderFixtures.snapshot({
        nodes: base.nodes,
        diagnostics: [
          {
            file: "a.ts",
            line: 1,
            column: 1,
            code: "TS1",
            message: "broken",
            severity: "error",
          },
        ],
      }),
    ),
    graphSnapshotDigests.contentOf(base),
  );

  // The digest covers a node's whole shape, not a chosen few fields: an
  // earlier form hashed id, kind, name, file, and span offsets only, so a
  // slice whose modifiers or export flag changed digested identically to the
  // one before it — while the transaction fence compared exactly this value to
  // decide whether anything had moved.
  const decorated: ISamchonGraphNode = {
    ...node("a.ts", "run", "typescript"),
    exported: true,
    modifiers: ["export", "async"],
    qualifiedName: "mod.run",
  };
  TestValidator.notEquals(
    "a changed modifier changes the content digest",
    graphSnapshotDigests.contentOf(
      ProviderFixtures.snapshot({
        nodes: [{ ...decorated, modifiers: ["export"] }],
      }),
    ),
    graphSnapshotDigests.contentOf(
      ProviderFixtures.snapshot({ nodes: [decorated] }),
    ),
  );
  TestValidator.notEquals(
    "a changed export flag changes the content digest",
    graphSnapshotDigests.contentOf(
      ProviderFixtures.snapshot({
        nodes: [{ ...decorated, exported: false }],
      }),
    ),
    graphSnapshotDigests.contentOf(
      ProviderFixtures.snapshot({ nodes: [decorated] }),
    ),
  );
  // Key order is not content. Two structurally identical nodes built by
  // different code paths describe one declaration and must digest alike.
  TestValidator.equals(
    "property order does not change the content digest",
    graphSnapshotDigests.contentOf(
      ProviderFixtures.snapshot({
        nodes: [
          {
            external: false,
            file: "a.ts",
            name: "run",
            language: "typescript",
            kind: "function",
            id: "a.ts#run",
          } as ISamchonGraphNode,
        ],
      }),
    ),
    graphSnapshotDigests.contentOf(
      ProviderFixtures.snapshot({ nodes: [node("a.ts", "run", "typescript")] }),
    ),
  );
  // Inside an array is the one place an `undefined` survives the object
  // filter, and it has to keep its place: an array's length is part of its
  // meaning, so dropping the hole would make two different lists agree.
  TestValidator.notEquals(
    "an undefined inside an array keeps its place",
    graphSnapshotDigests.contentOf(
      ProviderFixtures.snapshot({
        nodes: [
          {
            ...node("a.ts", "run", "typescript"),
            modifiers: [undefined, "export"],
          } as unknown as ISamchonGraphNode,
        ],
      }),
    ),
    graphSnapshotDigests.contentOf(
      ProviderFixtures.snapshot({
        nodes: [
          {
            ...node("a.ts", "run", "typescript"),
            modifiers: ["export"],
          } as ISamchonGraphNode,
        ],
      }),
    ),
  );
  // A JSON null is a value the walk has to render, not a hole to drop: a
  // producer that states a field as null said something, and it is not the
  // same thing as never having said it.
  TestValidator.notEquals(
    "an explicit null is not the same as an absent property",
    graphSnapshotDigests.contentOf(
      ProviderFixtures.snapshot({
        nodes: [
          {
            ...node("a.ts", "run", "typescript"),
            qualifiedName: null,
          } as unknown as ISamchonGraphNode,
        ],
      }),
    ),
    graphSnapshotDigests.contentOf(
      ProviderFixtures.snapshot({ nodes: [node("a.ts", "run", "typescript")] }),
    ),
  );
  // An absent optional property and one explicitly set to `undefined` are the
  // same fact about the declaration.
  TestValidator.equals(
    "an explicitly undefined property is absent",
    graphSnapshotDigests.contentOf(
      ProviderFixtures.snapshot({
        nodes: [
          {
            ...node("a.ts", "run", "typescript"),
            qualifiedName: undefined,
          } as ISamchonGraphNode,
        ],
      }),
    ),
    graphSnapshotDigests.contentOf(
      ProviderFixtures.snapshot({ nodes: [node("a.ts", "run", "typescript")] }),
    ),
  );

  const provenance = dumpProvenanceOf(base);
  TestValidator.equals(
    "provenance republishes what the registry declared",
    [provenance.provider, provenance.authority, provenance.languages],
    ["fake", "compiler", ["typescript"]],
  );
  TestValidator.equals(
    "provenance carries the publisher's own digests",
    [provenance.manifest, provenance.content],
    [graphSnapshotDigests.manifestOf(base), graphSnapshotDigests.contentOf(base)],
  );
  TestValidator.equals(
    "the producer is reported separately from the registry entry",
    [
      provenance.producer.tool,
      provenance.producer.version,
      provenance.producer.compiler,
      provenance.producer.schemaVersion,
      provenance.producer.protocolVersion,
    ],
    ["fake-provider", "1.0.0", "1.0.0", 5, 1],
  );
}

function node(
  file: string,
  name: string,
  language: ISamchonGraphNode["language"],
): ISamchonGraphNode {
  return {
    id: `${file}#${name}`,
    kind: "function",
    language,
    name,
    file,
    external: false,
  };
}
