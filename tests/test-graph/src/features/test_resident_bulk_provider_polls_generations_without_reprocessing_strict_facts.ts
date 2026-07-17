import { TestValidator } from "@nestia/e2e";
import {
  IBulkGraphSession,
  IIndexerResult,
  createResidentGraphSource,
} from "@samchon/graph";
import fs from "node:fs";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";

export const test_resident_bulk_provider_polls_generations_without_reprocessing_strict_facts =
  async () => {
    const root = GraphPaths.createTempDirectory("samchon-graph-resident-bulk-");
    const file = path.join(root, "a.ts");
    const text = "export const answer = 1;\n";
    fs.writeFileSync(file, text);
    const first = snapshot(file, text, "first");
    const second = snapshot(file, text, "second");
    let current = first;
    let generation = 1;
    let refreshes = 0;
    let closes = 0;
    let builds = 0;
    const session: IBulkGraphSession = {
      kind: "bulk",
      language: "typescript",
      root,
      get generation() {
        return generation;
      },
      get current() {
        return current;
      },
      async refresh() {
        refreshes += 1;
        if (refreshes === 2) {
          current = second;
          generation = 2;
          return {
            changed: true,
            generation,
            mode: "incremental",
            snapshot: current,
          };
        }
        if (refreshes === 3) throw new Error("synthetic provider failure");
        return {
          changed: false,
          generation,
          mode: "unchanged",
          snapshot: current,
        };
      },
      async close() {
        closes += 1;
      },
    };
    const initialDump = {
      project: root,
      // Exercise bookkeeping independently of the buildLspGraph regression:
      // an older/mocked pure-strict result may omit language metadata, but its
      // owned bulk session still determines the resident topology.
      languages: [] as const,
      indexer: "lsp" as const,
      nodes: first.nodes.map(({ evidence, ...node }) => ({
        ...node,
        evidence: {
          startLine: evidence!.startLine,
          endLine: evidence!.endLine,
        },
      })),
      edges: [],
      warnings: [],
    };
    const resident = createResidentGraphSource(
      { cwd: root, languages: ["typescript"] },
      {
        buildLspGraph: async () => {
          builds += 1;
          return {
            dump: initialDump,
            warnings: [],
            sessions: new Map([["typescript", session]]),
            // The session must remain authoritative even before it has exposed
            // a source-text snapshot.
            sources: new Map(),
          } as IIndexerResult;
        },
      },
    );

    const loaded = await resident.load();
    const unchanged = await resident.load();
    TestValidator.predicate(
      "an unchanged bulk generation reuses the resident dump object",
      unchanged === loaded,
    );
    const changed = await resident.load();
    TestValidator.predicate(
      "a changed full slice atomically replaces the resident dump",
      changed !== loaded &&
        changed.nodes.length === 1 &&
        changed.nodes[0]?.name === "second" &&
        changed.nodes[0]?.ignored === true &&
        changed.nodes[0]?.closure === true,
    );
    await rejects(resident.load(), "a provider poll failure is surfaced");
    const recovered = await resident.load();
    TestValidator.predicate(
      "the last published generation survives a failed provider poll",
      recovered === changed && recovered.nodes[0]?.name === "second",
    );
    TestValidator.equals(
      "an empty dump language list cannot misclassify or replace its strict session",
      builds,
      1,
    );
    await resident.close();
    TestValidator.equals("resident shutdown closes its owned bulk session once", closes, 1);
  };

function snapshot(
  file: string,
  text: string,
  name: string,
): IBulkGraphSession.ISnapshot {
  return {
    language: "typescript",
    nodes: [
      {
        id: `a.ts#${name}:function`,
        kind: "function",
        language: "typescript",
        name,
        file: "a.ts",
        external: false,
        ignored: true,
        closure: true,
        evidence: { file: "a.ts", startLine: 1, endLine: 1 },
      },
    ],
    edges: [],
    sources: new Map([[file, text]]),
    warnings: [],
  };
}

async function rejects(task: Promise<unknown>, label: string): Promise<void> {
  let error: unknown;
  try {
    await task;
  } catch (caught) {
    error = caught;
  }
  TestValidator.predicate(label, error instanceof Error);
}
