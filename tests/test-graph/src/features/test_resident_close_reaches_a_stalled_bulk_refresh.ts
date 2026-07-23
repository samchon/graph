import { TestValidator } from "@nestia/e2e";
import fs from "node:fs";

import { createResidentGraphSource } from "../../../../packages/graph/src/indexer/createResidentGraphSource";
import type { IIndexerResult } from "../../../../packages/graph/src/indexer/IIndexerResult";
import type { IBulkGraphSession } from "../../../../packages/graph/src/provider/IBulkGraphSession";
import { GraphPaths } from "../internal/GraphPaths";
import { ProviderFixtures } from "../internal/ProviderFixtures";

export const test_resident_close_reaches_a_stalled_bulk_refresh = async () => {
  const root = GraphPaths.createTempDirectory("samchon-graph-stalled-bulk-");
  fs.writeFileSync(`${root}/a.ts`, "export const answer = 1;\n");

  const snapshot: IBulkGraphSession.ISnapshot = ProviderFixtures.snapshot();
  let closeCalls = 0;
  let announceRefresh!: () => void;
  const refreshStarted = new Promise<void>((resolve) => {
    announceRefresh = resolve;
  });
  let rejectRefresh: ((error: Error) => void) | undefined;
  const session: IBulkGraphSession = {
    kind: "bulk",
    languages: ["typescript"],
    root,
    generation: 1,
    current: snapshot,
    refresh(options) {
      announceRefresh();
      return new Promise((_, reject) => {
        rejectRefresh = reject;
        options?.signal?.addEventListener(
          "abort",
          () => reject(new Error("synthetic refresh aborted")),
          { once: true },
        );
      });
    },
    async close() {
      closeCalls += 1;
      rejectRefresh?.(new Error("synthetic session closed"));
    },
  };
  const result: IIndexerResult = {
    dump: {
      project: root,
      languages: ["typescript"],
      indexer: "lsp",
      nodes: [],
      edges: [],
    },
    warnings: [],
    sessions: new Map([["typescript", session]]),
    sources: new Map(),
  };
  const resident = createResidentGraphSource(
    { cwd: root, languages: ["typescript"] },
    {
      providers: [],
      buildLspGraph: async () => result,
    },
  );

  await resident.load();
  const stalled = resident.load();
  await refreshStarted;
  const closing = resident.close();
  const [loadResult, closeResult] = await Promise.allSettled([
    stalled,
    closing,
  ]);

  TestValidator.equals(
    "resident close reaches its active bulk provider exactly once",
    closeCalls,
    1,
  );
  TestValidator.equals(
    "the stalled load rejects after shutdown",
    loadResult.status,
    "rejected",
  );
  TestValidator.equals(
    "shutdown settles after interrupting the stalled refresh",
    closeResult.status,
    "fulfilled",
  );

  let failedCloseCalls = 0;
  const unpublished: IBulkGraphSession = {
    kind: "bulk",
    languages: ["typescript"],
    root,
    generation: 0,
    current: undefined,
    refresh: async () => {
      throw new Error("unpublished session cannot refresh");
    },
    close: () => {
      failedCloseCalls += 1;
      return Promise.reject("synthetic close failure");
    },
  };
  const failed = createResidentGraphSource(
    { cwd: root, languages: ["typescript"] },
    {
      providers: [],
      buildLspGraph: async () => ({
        dump: {
          project: root,
          languages: ["typescript"],
          indexer: "lsp",
          nodes: [],
          edges: [],
        },
        warnings: [],
        sessions: new Map([["typescript", unpublished]]),
        sources: new Map(),
      }),
    },
  );
  await failed.load();
  const firstFailedClose = failed.close();
  const repeatedFailedClose = failed.close();
  let closeError: unknown;
  try {
    await firstFailedClose;
  } catch (error) {
    closeError = error;
  }
  TestValidator.predicate(
    "resident close is idempotent even when the owned provider rejects",
    firstFailedClose === repeatedFailedClose && failedCloseCalls === 1,
  );
  TestValidator.predicate(
    "a non-Error provider close failure is normalized and reported",
    closeError instanceof Error &&
      closeError.message === "synthetic close failure",
  );
};
