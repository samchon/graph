import { TestValidator } from "@nestia/e2e";
import fs from "node:fs";
import path from "node:path";

import { createResidentGraphSource } from "../../../../packages/graph/src/indexer/createResidentGraphSource";
import type { IIndexerResult } from "../../../../packages/graph/src/indexer/IIndexerResult";
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
  await assertAProviderThatMovedMidTransactionIsDiscarded();
};

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

  const provider = ProviderFixtures.provider({ name: "restless" });
  const session = ProviderFixtures.session({
    root,
    snapshots: [
      ProviderFixtures.snapshot({ provider: "restless" }),
      ProviderFixtures.snapshot({ provider: "restless" }),
      ProviderFixtures.snapshot({ provider: "restless" }),
    ],
  });

  let rebuilds = 0;
  const source = createResidentGraphSource(
    { cwd: root },
    {
      buildLspGraph: async () => ({
        ...resultOf(root, file, fs.readFileSync(file, "utf8")),
        sessions: new Map([["typescript", session]]),
        providers: new Map([["typescript", provider]]),
      }),
      staticGraphParts: (options, files) => {
        const parts = realStaticGraphParts(options, files);
        // The provider moves after this transaction already took its snapshot.
        if (rebuilds === 0) {
          rebuilds += 1;
          void session.refresh();
        }
        return parts;
      },
    },
  );

  await source.load();
  fs.writeFileSync(file, "export const value = 2;\n");
  let reported: string | undefined;
  try {
    await source.load();
  } catch (error) {
    reported = (error as Error).message;
  }
  TestValidator.predicate(
    "a provider that replaced its snapshot mid-transaction is refused",
    reported !== undefined && reported.includes("restless"),
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
        provider: "drifting",
        edges: [{ kind: "decorates", from: "x", to: "y" }],
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
