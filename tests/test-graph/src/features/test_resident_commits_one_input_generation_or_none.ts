import { TestValidator } from "@nestia/e2e";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { createResidentGraphSource } from "../../../../packages/graph/src/indexer/createResidentGraphSource";
import type { IIndexerResult } from "../../../../packages/graph/src/indexer/IIndexerResult";
import type { IBulkGraphSession } from "../../../../packages/graph/src/provider/IBulkGraphSession";
import { graphSnapshotDigests } from "../../../../packages/graph/src/provider/graphSnapshotDigests";
import { staticGraphParts as realStaticGraphParts } from "../../../../packages/graph/src/indexer/staticGraphParts";
import { GraphPaths } from "../internal/GraphPaths";
import { ProviderFixtures } from "../internal/ProviderFixtures";

/**
 * A resident refresh publishes one input generation, or none.
 *
 * Every slice is prepared at its own moment: the bulk providers answer first,
 * each generic session re-reads its documents next, the static lane parses
 * last. That the final object swap is atomic to a reader says nothing about the
 * inputs — a file edited between the compiler's export and the static parse
 * produces a dump whose halves describe two different checkouts, under an audit
 * that claims one. The fence is what makes the claim true.
 */
export const test_resident_commits_one_input_generation_or_none = async () => {
  await assertAMovedSourceDiscardsTheCandidate();
  await assertAPersistentlyMovingProjectIsReported();
  await assertALaterGenerationIsStillHeldToItsContract();
  await assertAMultiLanguageSessionIsMergedOnce();
  await assertABulkSliceLanguageChangeRebuildsTheResidentTopology();
  await assertAProviderThatMovedMidTransactionIsDiscarded();
  await assertAMovedExternalProviderSourceIsDiscarded();
  await assertAnUnchangedProviderCannotHideAMovedExternalSource();
  await assertAProviderTopologyChangeRebuildsTheResidentState();
  await assertAStableProviderFallbackKeepsTheResidentState();
  await assertConflictingProviderSourceDigestsAreRefused();
  await assertAHashOnlySourceMismatchRebuildsTheResidentState();
  await assertProvenanceDescribesThePublishedGeneration();
  await assertADeclaredBuildInputInvalidatesTheProject();
  await assertAChangedBuildInputSetReplacesTheResidentState();
  await assertARevertedGenericSourceDiscardsTheCandidate();
  await assertAMovedBuildInputDiscardsTheCandidate();
};

async function assertAProviderTopologyChangeRebuildsTheResidentState(): Promise<void> {
  const root = GraphPaths.createTempDirectory("samchon-graph-provider-topology-");
  const file = path.join(root, "a.ts");
  fs.writeFileSync(file, "export const value = 1;\n");
  let command = "first-provider";
  let builds = 0;
  const provider = ProviderFixtures.provider({
    name: "moving-provider",
    resolve: () => ({ command, args: [] }),
  });
  const source = createResidentGraphSource(
    { cwd: root },
    {
      providers: [provider],
      buildLspGraph: async () => {
        builds += 1;
        return {
          ...resultOf(root, file, fs.readFileSync(file, "utf8")),
          providers: new Map([["typescript", provider]]),
        };
      },
    },
  );
  await source.load();
  command = "second-provider";
  await source.load();
  TestValidator.equals(
    "a moved provider command replaces the complete resident state",
    builds,
    2,
  );
  await source.close();
}

async function assertAMovedExternalProviderSourceIsDiscarded(): Promise<void> {
  const root = GraphPaths.createTempDirectory(
    "samchon-graph-provider-sibling-refresh-",
  );
  const siblingRoot = GraphPaths.createTempDirectory(
    "samchon-graph-provider-sibling-source-",
  );
  const typescript = path.join(root, "a.ts");
  const go = path.join(root, "b.go");
  const sibling = path.join(siblingRoot, "shared.ts");
  fs.writeFileSync(typescript, "export const value = 1;\n");
  fs.writeFileSync(go, "package main\nfunc main() {}\n");
  fs.writeFileSync(sibling, "export const shared = 0;\n");

  const consumed = sha256(fs.readFileSync(sibling));
  const provider = ProviderFixtures.provider({ name: "sibling-provider" });
  const snapshot = ProviderFixtures.snapshot({
    provider: "sibling-provider",
    capabilities: ["universe", "sourceDigests", "diskDigests"],
    sources: new Map([
      [sibling, { checkerDigest: consumed, diskDigest: consumed }],
    ]),
  });
  const session = ProviderFixtures.session({ root, snapshots: [snapshot] });
  let parses = 0;
  const source = createResidentGraphSource(
    { cwd: root },
    {
      providers: [provider],
      buildLspGraph: async () => {
        const result = resultOf(
          root,
          typescript,
          fs.readFileSync(typescript, "utf8"),
        );
        return {
          ...result,
          dump: {
            ...result.dump,
            languages: ["typescript", "go"],
          },
          sources: new Map([
            [typescript, fs.readFileSync(typescript, "utf8")],
            [go, fs.readFileSync(go, "utf8")],
          ]),
          sessions: new Map([["typescript", session]]),
          providers: new Map([["typescript", provider]]),
        };
      },
      staticGraphParts: (options, files) => {
        const parts = realStaticGraphParts(options, files);
        parses += 1;
        fs.writeFileSync(
          sibling,
          `export const shared = ${String(parses)};\n`,
        );
        return parts;
      },
    },
  );
  await source.load();
  let failure: unknown;
  try {
    await source.load();
  } catch (error) {
    failure = error;
  }
  TestValidator.predicate(
    "a provider-owned sibling that moves during resident refresh never publishes",
    parses === 3 &&
      failure instanceof Error &&
      failure.message.includes("does not bind the provider snapshot"),
  );
  await source.close();
}

async function assertAnUnchangedProviderCannotHideAMovedExternalSource(): Promise<void> {
  const root = GraphPaths.createTempDirectory(
    "samchon-graph-provider-unchanged-sibling-",
  );
  const siblingRoot = GraphPaths.createTempDirectory(
    "samchon-graph-provider-unchanged-source-",
  );
  const file = path.join(root, "a.ts");
  const sibling = path.join(siblingRoot, "shared.ts");
  fs.writeFileSync(file, "export const value = 1;\n");
  fs.writeFileSync(sibling, "export const shared = 1;\n");
  const consumed = sha256(fs.readFileSync(sibling));
  const provider = ProviderFixtures.provider({ name: "unchanged-sibling" });
  const snapshot = ProviderFixtures.snapshot({
    root,
    provider: "unchanged-sibling",
    capabilities: ["universe", "sourceDigests", "diskDigests"],
    sources: new Map([
      [sibling, { checkerDigest: consumed, diskDigest: consumed }],
    ]),
  });
  const session: IBulkGraphSession = {
    kind: "bulk",
    languages: ["typescript"],
    root,
    generation: 1,
    current: snapshot,
    refresh: async () => ({
      changed: false,
      generation: 1,
      mode: "unchanged",
      snapshot,
    }),
    close: async () => undefined,
  };
  const source = createResidentGraphSource(
    { cwd: root },
    {
      providers: [provider],
      buildLspGraph: async () => ({
        ...resultOf(root, file, fs.readFileSync(file, "utf8")),
        sessions: new Map([["typescript", session]]),
        providers: new Map([["typescript", provider]]),
      }),
    },
  );
  await source.load();
  fs.writeFileSync(sibling, "export const shared = 2;\n");
  let failure: unknown;
  try {
    await source.load();
  } catch (error) {
    failure = error;
  }
  TestValidator.predicate(
    "an unchanged provider cannot hide movement in an external owned source",
    failure instanceof Error &&
      failure.message.includes("does not bind the provider snapshot"),
  );
  await source.close();
}

async function assertAStableProviderFallbackKeepsTheResidentState(): Promise<void> {
  const root = GraphPaths.createTempDirectory(
    "samchon-graph-provider-fallback-topology-",
  );
  const file = path.join(root, "a.ts");
  fs.writeFileSync(file, "export const value = 1;\n");
  let builds = 0;
  const provider = ProviderFixtures.provider({
    name: "stable-failing-provider",
    resolve: () => ({ command: "stable-provider", args: [] }),
  });
  const source = createResidentGraphSource(
    { cwd: root },
    {
      providers: [provider],
      buildLspGraph: async () => {
        builds += 1;
        return resultOf(root, file, fs.readFileSync(file, "utf8"));
      },
    },
  );
  await source.load();
  await source.load();
  TestValidator.equals(
    "a consistently falling-back provider does not rebuild unchanged state",
    builds,
    1,
  );
  fs.writeFileSync(file, "export const value = 2;\n");
  await source.load();
  TestValidator.equals(
    "a changed input generation retries a previously failed provider",
    builds,
    2,
  );
  await source.close();
}

async function assertConflictingProviderSourceDigestsAreRefused(): Promise<void> {
  const root = GraphPaths.createTempDirectory(
    "samchon-graph-provider-digest-conflict-",
  );
  const typescript = path.join(root, "a.ts");
  const go = path.join(root, "b.go");
  fs.writeFileSync(typescript, "export const value = 1;\n");
  fs.writeFileSync(go, "package main\nfunc main() {}\n");
  const common = path.join(root, "shared.txt");
  fs.writeFileSync(common, "shared\n");
  const firstProvider = ProviderFixtures.provider({
    name: "first-digest",
    languages: ["typescript"],
  });
  const secondProvider = ProviderFixtures.provider({
    name: "second-digest",
    languages: ["go"],
  });
  const first = ProviderFixtures.snapshot({
    root,
    provider: "first-digest",
    languages: ["typescript"],
    sources: new Map([
      [
        process.platform === "win32" ? common.toUpperCase() : common,
        {
          checkerDigest: "a".repeat(64),
          diskDigest: "a".repeat(64),
        },
      ],
    ]),
  });
  const second = ProviderFixtures.snapshot({
    root,
    provider: "second-digest",
    languages: ["go"],
    sources: new Map([
      [
        common,
        {
          checkerDigest: "b".repeat(64),
          diskDigest: "b".repeat(64),
        },
      ],
    ]),
  });
  const firstSession = ProviderFixtures.session({
    root,
    languages: ["typescript"],
    snapshots: [first],
  });
  const secondSession = ProviderFixtures.session({
    root,
    languages: ["go"],
    snapshots: [second],
  });
  await firstSession.refresh();
  await secondSession.refresh();
  const source = createResidentGraphSource(
    { cwd: root },
    {
      providers: [firstProvider, secondProvider],
      buildLspGraph: async () => ({
        ...resultOf(root, typescript, fs.readFileSync(typescript, "utf8")),
        dump: {
          ...resultOf(
            root,
            typescript,
            fs.readFileSync(typescript, "utf8"),
          ).dump,
          languages: ["typescript", "go"],
        },
        sources: new Map([
          [typescript, fs.readFileSync(typescript, "utf8")],
          [go, fs.readFileSync(go, "utf8")],
        ]),
        sessions: new Map([
          ["typescript", firstSession],
          ["go", secondSession],
        ]),
        providers: new Map([
          ["typescript", firstProvider],
          ["go", secondProvider],
        ]),
      }),
    },
  );
  let failure: unknown;
  try {
    await source.load();
  } catch (error) {
    failure = error;
  }
  TestValidator.predicate(
    "one provider cannot hide another provider's conflicting source digest",
    failure instanceof Error &&
      failure.message.includes("conflicting source digests"),
  );
  await source.close();
}

async function assertAHashOnlySourceMismatchRebuildsTheResidentState(): Promise<void> {
  const root = GraphPaths.createTempDirectory("samchon-graph-hash-topology-");
  const sourceFile = path.join(root, "a.ts");
  const unselected = path.join(root, "README.md");
  fs.writeFileSync(sourceFile, "export const value = 1;\n");
  fs.writeFileSync(unselected, "fixture\n");
  let builds = 0;
  const source = createResidentGraphSource(
    { cwd: root },
    {
      providers: [],
      buildLspGraph: async () => {
        builds += 1;
        return {
          ...resultOf(root, sourceFile, fs.readFileSync(sourceFile, "utf8")),
          sources: new Map([[unselected, fs.readFileSync(unselected, "utf8")]]),
        };
      },
    },
  );
  await source.load();
  await source.load();
  TestValidator.equals(
    "a same-sized but differently keyed source snapshot is stale",
    builds,
    2,
  );
  await source.close();
}

async function assertADeclaredBuildInputInvalidatesTheProject(): Promise<void> {
  const root = GraphPaths.createTempDirectory("samchon-graph-build-input-");
  const file = path.join(root, "a.ts");
  const config = path.join(root, "project.generated");
  fs.writeFileSync(file, "export const value = 1;\n");
  fs.writeFileSync(config, "first\n");
  let parses = 0;
  const source = createResidentGraphSource(
    { cwd: root },
    {
      buildLspGraph: async () => ({
        ...resultOf(root, file, fs.readFileSync(file, "utf8")),
        buildInputs: ["project.generated"],
      }),
      staticGraphParts: (options, files) => {
        parses += 1;
        return realStaticGraphParts(options, files);
      },
    },
  );
  await source.load();
  fs.writeFileSync(config, "second\n");
  await source.load();
  TestValidator.equals(
    "a provider-declared generated/config input invalidates the whole project",
    parses,
    1,
  );
  await source.close();
}

async function assertAChangedBuildInputSetReplacesTheResidentState(): Promise<void> {
  const root = GraphPaths.createTempDirectory(
    "samchon-graph-build-input-set-",
  );
  const file = path.join(root, "a.ts");
  fs.writeFileSync(file, "export const value = 1;\n");
  let includeGenerated = false;
  let moveDuringRefresh = false;
  let builds = 0;
  let parses = 0;
  const provider = ProviderFixtures.provider({
    name: "dynamic-build-inputs",
    buildInputs: () => (includeGenerated ? ["late.generated"] : []),
    resolve: () => undefined,
  });
  const source = createResidentGraphSource(
    { cwd: root },
    {
      providers: [provider],
      buildLspGraph: async () => {
        builds += 1;
        return resultOf(root, file, fs.readFileSync(file, "utf8"));
      },
      staticGraphParts: (options, files) => {
        parses += 1;
        const parts = realStaticGraphParts(options, files);
        if (moveDuringRefresh) {
          includeGenerated = true;
          fs.writeFileSync(path.join(root, "late.generated"), "generated\n");
        }
        return parts;
      },
    },
  );
  await source.load();
  const firstGeneration = source.inputGeneration();
  fs.writeFileSync(file, "export const value = 2;\n");
  moveDuringRefresh = true;
  await source.load();
  moveDuringRefresh = false;
  const secondGeneration = source.inputGeneration();
  await source.load();
  TestValidator.predicate(
    "a provider build-input set that moves mid-refresh replaces once and becomes the new fence",
    builds === 2 &&
      parses === 1 &&
      firstGeneration !== secondGeneration &&
      secondGeneration === source.inputGeneration(),
  );
  await source.close();
}

async function assertARevertedGenericSourceDiscardsTheCandidate(): Promise<void> {
  const root = GraphPaths.createTempDirectory(
    "samchon-graph-consumed-source-revert-",
  );
  const file = path.join(root, "a.ts");
  const config = path.join(root, "project.generated");
  const original = "export const value = 1;\n";
  fs.writeFileSync(file, original);
  fs.writeFileSync(config, "first\n");
  let parses = 0;
  const source = createResidentGraphSource(
    { cwd: root },
    {
      buildLspGraph: async () => ({
        ...resultOf(root, file, fs.readFileSync(file, "utf8")),
        buildInputs: ["project.generated"],
      }),
      staticGraphParts: (options, files) => {
        parses += 1;
        if (parses !== 1) return realStaticGraphParts(options, files);
        fs.writeFileSync(file, "export const value = 2;\n");
        const parts = realStaticGraphParts(options, files);
        fs.writeFileSync(file, original);
        return parts;
      },
    },
  );
  await source.load();
  const firstGeneration = source.inputGeneration();
  fs.writeFileSync(config, "second\n");
  await source.load();
  TestValidator.predicate(
    "generic bytes from a change-then-revert candidate never publish",
    parses === 2 && source.inputGeneration() !== firstGeneration,
  );
  await source.close();
}

async function assertAMovedBuildInputDiscardsTheCandidate(): Promise<void> {
  const root = GraphPaths.createTempDirectory(
    "samchon-graph-build-input-fence-",
  );
  const file = path.join(root, "a.ts");
  const config = path.join(root, "project.generated");
  fs.writeFileSync(file, "export const value = 1;\n");
  fs.writeFileSync(config, "first\n");

  let parses = 0;
  const source = createResidentGraphSource(
    { cwd: root },
    {
      buildLspGraph: async () => ({
        ...resultOf(root, file, fs.readFileSync(file, "utf8")),
        buildInputs: ["project.generated"],
      }),
      staticGraphParts: (options, files) => {
        parses += 1;
        const parts = realStaticGraphParts(options, files);
        if (parses === 1) fs.writeFileSync(config, "third\n");
        return parts;
      },
    },
  );
  await source.load();
  fs.writeFileSync(config, "second\n");
  await source.load();
  TestValidator.equals(
    "a build input that moves during refresh discards and rebuilds the candidate",
    parses,
    2,
  );
  await source.close();
}

/**
 * A refresh republishes its own provenance rather than inheriting one.
 *
 * The row carries manifest and content digests, which are a *proof* about one
 * generation. Carrying a previous one forward states that a generation nobody
 * produced is still current, and a reader comparing digests concludes nothing
 * moved — the same hazard that retired the carried-forward diagnostics array.
 */
async function assertProvenanceDescribesThePublishedGeneration(): Promise<void> {
  const root = GraphPaths.createTempDirectory("samchon-graph-provenance-gen-");
  const file = path.join(root, "a.ts");
  fs.writeFileSync(file, "export const value = 1;\n");

  const provider = ProviderFixtures.provider({ name: "moving" });
  const firstSnapshot = ProviderFixtures.snapshot({
    root,
    provider: "moving",
    sources: new Map([
      [
        file,
        {
          checkerDigest: sha256(Buffer.from("export const value = 1;\n")),
          diskDigest: sha256(Buffer.from("export const value = 1;\n")),
        },
      ],
    ]),
  });
  const secondSnapshot = ProviderFixtures.snapshot({
    root,
    provider: "moving",
    sources: new Map([
      [
        file,
        {
          checkerDigest: sha256(Buffer.from("export const value = 2;\n")),
          diskDigest: sha256(Buffer.from("export const value = 2;\n")),
        },
      ],
    ]),
  });
  const session = ProviderFixtures.session({
    root,
    snapshots: [firstSnapshot, secondSnapshot],
  });

  const source = createResidentGraphSource(
    { cwd: root },
    {
      buildLspGraph: async () => ({
        ...resultOf(root, file, fs.readFileSync(file, "utf8")),
        sessions: new Map([["typescript", session]]),
        providers: new Map([["typescript", provider]]),
      }),
    },
  );

  // This fixture supplies a resident session directly, whereas the production
  // builder polls one before it returns its first dump. The opening load
  // therefore establishes the resident state; the next one publishes the
  // first strict generation.
  await source.load();
  const first = await source.load();
  const before = first.provenance?.[0]?.manifest;
  const firstGeneration = source.inputGeneration();
  TestValidator.equals(
    "the first bulk generation publishes its own manifest digest",
    before,
    graphSnapshotDigests.manifestOf(firstSnapshot),
  );
  TestValidator.predicate(
    "the resident exposes the complete generation belonging to its dump",
    firstGeneration !== undefined && /^[a-f0-9]{64}$/.test(firstGeneration),
  );

  fs.writeFileSync(file, "export const value = 2;\n");
  const second = await source.load();
  TestValidator.equals(
    "a later generation publishes its own manifest digest, not the one before",
    second.provenance?.[0]?.manifest,
    graphSnapshotDigests.manifestOf(secondSnapshot),
  );
  TestValidator.notEquals(
    "provider checker and disk movement replaces the project generation token",
    source.inputGeneration(),
    firstGeneration,
  );
  const stableGeneration = source.inputGeneration();
  await source.load();
  TestValidator.equals(
    "an unchanged resident load retains the exact generation token",
    source.inputGeneration(),
    stableGeneration,
  );
  await source.close();
}

/**
 * A provider that rebuilt mid-transaction does not get committed beside the
 * lanes that read before it.
 *
 * Bulk sessions are polled at the start of a refresh, and the generic lanes
 * read afterwards. A provider that replaced its snapshot in between leaves this
 * transaction holding one program's facts next to another's — the exact mixture
 * the fence exists to refuse, arriving through the one lane it was not
 * watching. Its manifest digest is its revision token, and naming that in a
 * comment is not the same as checking it.
 */
async function assertAProviderThatMovedMidTransactionIsDiscarded(): Promise<void> {
  const root = GraphPaths.createTempDirectory("samchon-graph-provider-moved-");
  const file = path.join(root, "a.ts");
  fs.writeFileSync(file, "export const value = 1;\n");
  // A mixed project, which is the shape this fence exists for: the provider
  // answers for TypeScript and the static lane parses Go afterwards. With one
  // language and one session there is no static lane at all, so the window
  // between the provider's answer and the commit — the window being tested —
  // never opens.
  fs.writeFileSync(path.join(root, "b.go"), "package main\nfunc main() {}\n");

  const provider = ProviderFixtures.provider({ name: "restless" });
  // Hand-rolled rather than scripted, because the rebuild has to be observable
  // at the moment the fence looks. The transaction runs from the static parse
  // to the fence without awaiting anything, so a refresh started there would
  // still be a pending microtask when the check reads `current` — the test
  // would pass or fail on scheduling rather than on the behaviour.
  const taken = ProviderFixtures.snapshot({ root, provider: "restless" });
  const rebuilt = ProviderFixtures.snapshot({ root, provider: "restless" });
  let published = taken;
  const session: IBulkGraphSession = {
    kind: "bulk",
    languages: ["typescript"],
    root,
    generation: 1,
    get current() {
      return published;
    },
    refresh: async () => ({
      changed: false,
      generation: 1,
      mode: "unchanged",
      snapshot: published,
    }),
    close: async () => undefined,
  };

  let rebuilds = 0;
  let parses = 0;
  const source = createResidentGraphSource(
    { cwd: root },
    {
      providers: [provider],
      buildLspGraph: async () => {
        const result = resultOf(root, file, fs.readFileSync(file, "utf8"));
        const go = path.join(root, "b.go");
        return {
          ...result,
          // Go is reported but has no session, which is what makes it the
          // static lane's and gives the transaction a second phase.
          dump: { ...result.dump, languages: ["typescript", "go"] },
          // Both consumed files, because the resident source derives the
          // language set it guards from these keys. Naming only the TypeScript
          // one would make discovery see a language the state does not, and
          // the load would rebuild from scratch instead of refreshing — past
          // the transaction this case is about.
          sources: new Map([
            [file, fs.readFileSync(file, "utf8")],
            [go, fs.readFileSync(go, "utf8")],
          ]),
          sessions: new Map([["typescript", session]]),
          providers: new Map([["typescript", provider]]),
        };
      },
      staticGraphParts: (options, files) => {
        parses += 1;
        const parts = realStaticGraphParts(options, files);
        // The provider moves after this transaction already took its snapshot.
        if (rebuilds === 0) {
          rebuilds += 1;
          published = rebuilt;
        }
        return parts;
      },
    },
  );

  await source.load();
  const before = parses;
  const dump = await source.load();

  // The candidate holding the superseded snapshot is discarded and the refresh
  // prepares again — which is the retry doing its job, not a failure. What
  // must not happen is committing that candidate beside lanes that read after
  // the provider had already moved.
  TestValidator.equals(
    "a superseded provider snapshot forces the candidate to be prepared again",
    parses - before,
    2,
  );
  TestValidator.equals(
    "and what finally commits is the generation the provider actually holds",
    dump.provenance?.[0]?.content,
    graphSnapshotDigests.contentOf(rebuilt),
  );
  await source.close();
}

/**
 * A provider owning two languages is one session, merged once.
 *
 * It appears in the session map under each language it owns, pointing at one
 * object. Merging per key would publish every node it produced twice, which
 * the strict-slice validator rejects as duplicated — after the provider had
 * already done the work a second time.
 */
async function assertAMultiLanguageSessionIsMergedOnce(): Promise<void> {
  const root = GraphPaths.createTempDirectory("samchon-graph-two-languages-");
  const file = path.join(root, "a.ts");
  fs.writeFileSync(file, "export const value = 1;\n");
  fs.writeFileSync(path.join(root, "b.go"), "package main\n");

  const provider = ProviderFixtures.provider({
    name: "both",
    languages: ["typescript", "go"],
  });
  const snapshot = ProviderFixtures.snapshot({
    root,
    languages: ["typescript", "go"],
    provider: "both",
    nodes: [
      {
        id: "a.ts#shared:function",
        kind: "function",
        language: "typescript",
        name: "shared",
        file: "a.ts",
        external: false,
      },
    ],
  });
  const session = ProviderFixtures.session({
    root,
    languages: ["typescript", "go"],
    snapshots: [snapshot],
  });

  const source = createResidentGraphSource(
    { cwd: root },
    {
      providers: [provider],
      buildLspGraph: async () => ({
        ...resultOf(root, file, fs.readFileSync(file, "utf8")),
        sessions: new Map([
          ["typescript", session],
          ["go", session],
        ]),
        providers: new Map([
          ["typescript", provider],
          ["go", provider],
        ]),
      }),
    },
  );

  await source.load();
  const dump = await source.load();
  TestValidator.equals(
    "a two-language session contributes its nodes once",
    dump.nodes.filter((node) => node.name === "shared").length,
    1,
  );
  await source.close();
}

/**
 * A partial initial bulk slice can gain a language without the filesystem
 * gaining one. The old state still routes that language through its fallback,
 * so it must be rebuilt before the new slice is merged beside it.
 */
async function assertABulkSliceLanguageChangeRebuildsTheResidentTopology(): Promise<void> {
  const root = GraphPaths.createTempDirectory("samchon-graph-bulk-topology-");
  const typescript = path.join(root, "a.ts");
  const go = path.join(root, "b.go");
  fs.writeFileSync(typescript, "export const value = 1;\n");
  fs.writeFileSync(go, "package main\n");

  const provider = ProviderFixtures.provider({
    name: "expanding",
    languages: ["typescript", "go"],
  });
  const partial = ProviderFixtures.snapshot({
    root,
    languages: ["typescript"],
    provider: "expanding",
    nodes: [
      {
        id: "a.ts#strict:function",
        kind: "function",
        language: "typescript",
        name: "strict",
        file: "a.ts",
        external: false,
      },
    ],
  });
  const expanded = ProviderFixtures.snapshot({
    root,
    languages: ["typescript", "go"],
    provider: "expanding",
    nodes: [
      {
        id: "a.ts#strict:function",
        kind: "function",
        language: "typescript",
        name: "strict",
        file: "a.ts",
        external: false,
      },
      {
        id: "b.go#strict:function",
        kind: "function",
        language: "go",
        name: "strict",
        file: "b.go",
        external: false,
      },
    ],
  });
  let generation = 1;
  let current = partial;
  let partialCloseCalls = 0;
  const partialSession: IBulkGraphSession = {
    kind: "bulk",
    languages: ["typescript", "go"],
    root,
    get generation() {
      return generation;
    },
    get current() {
      return current;
    },
    refresh: async () => {
      generation = 2;
      current = expanded;
      return {
        changed: true,
        generation,
        mode: "rebuild",
        snapshot: expanded,
      };
    },
    close: async () => {
      partialCloseCalls += 1;
    },
  };
  const replacementSession: IBulkGraphSession = {
    kind: "bulk",
    languages: ["typescript", "go"],
    root,
    generation: 1,
    current: expanded,
    refresh: async () => ({
      changed: false,
      generation: 1,
      mode: "unchanged",
      snapshot: expanded,
    }),
    close: async () => undefined,
  };

  let builds = 0;
  const source = createResidentGraphSource(
    { cwd: root },
    {
      providers: [provider],
      buildLspGraph: async () => {
        builds += 1;
        if (builds === 1) {
          return {
            dump: {
              project: root,
              languages: ["typescript", "go"],
              indexer: "hybrid",
              nodes: [
                ...partial.nodes,
                {
                  id: "b.go#fallback:function",
                  kind: "function",
                  language: "go",
                  name: "fallback",
                  file: "b.go",
                  external: false,
                },
              ],
              edges: [],
            },
            warnings: [],
            sessions: new Map([["typescript", partialSession]]),
            // The strict provider's TypeScript bytes are in its manifest, not
            // the generic source map. Only Go is currently on the fallback
            // lane, so this makes the ordinary freshness check stay quiet.
            sources: new Map([[go, fs.readFileSync(go, "utf8")]]),
            providers: new Map([["typescript", provider]]),
          };
        }
        return {
          dump: {
            project: root,
            languages: ["typescript", "go"],
            indexer: "lsp",
            nodes: expanded.nodes,
            edges: [],
          },
          warnings: [],
          sessions: new Map([
            ["typescript", replacementSession],
            ["go", replacementSession],
          ]),
          sources: new Map(),
          providers: new Map([
            ["typescript", provider],
            ["go", provider],
          ]),
        };
      },
    },
  );

  await source.load();
  const refreshed = await source.load();
  TestValidator.equals(
    "a changed bulk slice language set rebuilds the resident state",
    builds,
    2,
  );
  TestValidator.equals(
    "the old partial bulk session is closed during replacement",
    partialCloseCalls,
    1,
  );
  TestValidator.equals(
    "the replacement has one strict slice for each language",
    refreshed.nodes.map((node) => `${node.language}:${node.name}`).sort(),
    ["go:strict", "typescript:strict"],
  );
  await source.close();
}

async function assertAMovedSourceDiscardsTheCandidate(): Promise<void> {
  const root = GraphPaths.createTempDirectory("samchon-graph-fence-");
  const file = path.join(root, "a.ts");
  fs.writeFileSync(file, "export const value = 1;\n");

  // The static parse is what closes the preparation phase, so the project is
  // moved from inside it exactly once: the candidate it just produced now
  // describes source nobody has. The retry then finds the project still.
  let edits = 0;
  let parses = 0;
  const source = createResidentGraphSource(
    { cwd: root },
    {
      buildLspGraph: async () =>
        resultOf(root, file, fs.readFileSync(file, "utf8")),
      staticGraphParts: (options, files) => {
        parses += 1;
        const parts = realStaticGraphParts(options, files);
        if (edits === 0) {
          edits += 1;
          fs.writeFileSync(file, "export const value = 2;\n");
        }
        return parts;
      },
    },
  );

  const dump = await source.load();
  TestValidator.equals(
    "the first load publishes what it read",
    dump.nodes.length,
    1,
  );
  // A refresh only happens for a project that moved, so move it. The build
  // that publishes the first generation never reaches the static lane, which
  // is why the fence cannot fire on it.
  fs.writeFileSync(file, "export const value = 1; // touched\n");
  // The second load prepares a candidate, finds the file moved under it,
  // discards it whole, and retries — so what it publishes is one generation.
  const refreshed = await source.load();
  TestValidator.equals(
    "a refresh that had to retry still publishes one whole generation",
    refreshed.nodes.length,
    1,
  );
  // The retry is the point of the case, so assert it happened. Without this
  // the assertions above pass just as well when the fence never fires — which
  // is exactly how an earlier version of this test passed while proving
  // nothing.
  TestValidator.equals(
    "the candidate really was discarded and prepared a second time",
    parses,
    2,
  );
  await source.close();
}

async function assertAPersistentlyMovingProjectIsReported(): Promise<void> {
  const root = GraphPaths.createTempDirectory("samchon-graph-fence-busy-");
  const file = path.join(root, "a.ts");
  fs.writeFileSync(file, "export const value = 1;\n");

  let revision = 0;
  const source = createResidentGraphSource(
    { cwd: root },
    {
      buildLspGraph: async () =>
        resultOf(root, file, fs.readFileSync(file, "utf8")),
      staticGraphParts: (options, files) => {
        const parts = realStaticGraphParts(options, files);
        // Every attempt is overtaken. The bound is what keeps this from never
        // returning. The written text must differ from every earlier one,
        // including the original: a project edited back to a state it already
        // had is genuinely unchanged, and the next attempt would rightly stop
        // rather than retry.
        revision += 1;
        fs.writeFileSync(
          file,
          `export const value = 1; // revision ${String(revision)}\n`,
        );
        return parts;
      },
    },
  );

  await source.load();
  fs.writeFileSync(file, "export const value = 0; // touched\n");
  let reported: string | undefined;
  try {
    await source.load();
  } catch (error) {
    reported = (error as Error).message;
  }
  // Rejecting rather than handing back the previous dump: that generation
  // survives, but attaching this call's "for the snapshot this call synced to"
  // to a snapshot it did not sync to would be the lie the fence exists to stop.
  TestValidator.predicate(
    "a project that will not hold still is reported, not papered over",
    reported !== undefined && reported.includes("kept changing"),
  );
  await source.close();
}

async function assertALaterGenerationIsStillHeldToItsContract(): Promise<void> {
  const root = GraphPaths.createTempDirectory("samchon-graph-contract-");
  const file = path.join(root, "a.ts");
  fs.writeFileSync(file, "export const value = 1;\n");

  const provider = ProviderFixtures.provider({ name: "drifting" });
  // Honest first, then publishing an edge family it never claimed. A session
  // checked only on its initial build would merge the second straight into the
  // dump — and the second generation onward is where a long-lived session
  // spends its entire working life.
  const session = ProviderFixtures.session({
    root,
    snapshots: [
      ProviderFixtures.snapshot({
        root,
        provider: "drifting",
        nodes: [
          {
            id: "a.ts#strict:function",
            kind: "function",
            language: "typescript",
            name: "strict",
            file: "a.ts",
            external: false,
          },
        ],
      }),
      ProviderFixtures.snapshot({
        root,
        provider: "drifting",
        nodes: [
          {
            id: "a.ts#owner:function",
            kind: "function",
            language: "typescript",
            name: "owner",
            file: "a.ts",
            external: false,
          },
          {
            id: "a.ts#decorator:function",
            kind: "function",
            language: "typescript",
            name: "decorator",
            file: "a.ts",
            external: false,
          },
        ],
        edges: [
          {
            kind: "decorates",
            from: "a.ts#owner:function",
            to: "a.ts#decorator:function",
          },
        ],
      }),
    ],
  });

  const source = createResidentGraphSource(
    { cwd: root },
    {
      buildLspGraph: async () => ({
        ...resultOf(root, file, fs.readFileSync(file, "utf8")),
        sessions: new Map([["typescript", session]]),
        providers: new Map([["typescript", provider]]),
      }),
    },
  );

  // The build that opens the session does not poll it, so the honest snapshot
  // is what the *second* load commits. The third is the one that drifts, which
  // is the point: a session checked only when it was opened would never have
  // been asked again.
  await source.load();
  const honest = await source.load();
  TestValidator.equals(
    "the session's first generation is published",
    honest.nodes.map((node) => node.name),
    ["strict"],
  );

  let refused: string | undefined;
  try {
    await source.load();
  } catch (error) {
    refused = (error as Error).message;
  }
  TestValidator.predicate(
    "a later generation outside the provider's contract is refused",
    refused !== undefined && refused.includes("decorates"),
  );
  await source.close();
}

/** One generic-lane build result whose consumed text is exactly `text`. */
function resultOf(root: string, file: string, text: string): IIndexerResult {
  return {
    dump: {
      project: root,
      languages: ["typescript"],
      indexer: "lsp",
      nodes: [
        {
          id: "a.ts#value:variable",
          kind: "variable",
          language: "typescript",
          name: "value",
          file: "a.ts",
          external: false,
        },
      ],
      edges: [],
    },
    warnings: [],
    sessions: new Map(),
    sources: new Map([[file, text]]),
  };
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
