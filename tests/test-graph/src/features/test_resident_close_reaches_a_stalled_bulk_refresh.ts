import { TestValidator } from "@nestia/e2e";
import fs from "node:fs";

import { createResidentGraphSource } from "../../../../packages/graph/src/indexer/createResidentGraphSource";
import type { IIndexerResult } from "../../../../packages/graph/src/indexer/IIndexerResult";
import type { IBulkGraphSession } from "../../../../packages/graph/src/provider/IBulkGraphSession";
import { GraphPaths } from "../internal/GraphPaths";

export const test_resident_close_reaches_a_stalled_bulk_refresh = async () => {
  const root = GraphPaths.createTempDirectory("samchon-graph-stalled-bulk-");
  fs.writeFileSync(`${root}/a.ts`, "export const answer = 1;\n");

  const snapshot: IBulkGraphSession.ISnapshot = {
    language: "typescript",
    nodes: [],
    edges: [],
    diagnostics: [],
    sources: new Map(),
    provenance: {
      schemaVersion: 5,
      tool: "fake-ttscgraph",
      toolVersion: "test",
      compilerVersion: "test",
      protocolVersion: 1,
      universe: "test",
      capabilities: [],
    },
    warnings: [],
  };
  let closeCalls = 0;
  let announceRefresh!: () => void;
  const refreshStarted = new Promise<void>((resolve) => {
    announceRefresh = resolve;
  });
  let rejectRefresh: ((error: Error) => void) | undefined;
  const session: IBulkGraphSession = {
    kind: "bulk",
    language: "typescript",
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
    { buildLspGraph: async () => result },
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
};
