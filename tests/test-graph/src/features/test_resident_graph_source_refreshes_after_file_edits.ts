import { TestValidator } from "@nestia/e2e";
import { createResidentGraphSource } from "@samchon/graph";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";

const residentFixture = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-resident-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  const ts = (name: string): void => {
    fs.writeFileSync(
      path.join(root, "src", name),
      "export function original(): void {}\n",
    );
  };
  ts("a.ts");
  ts("b.ts");
  ts("e.ts");
  fs.writeFileSync(
    path.join(root, "src", "c.py"),
    "def helper():\n    return 1\n",
  );
  return root;
};

const nodeNames = (dump: { nodes: readonly { name: string }[] }): string[] =>
  dump.nodes.map((node) => node.name);

export const test_resident_graph_source_refreshes_after_file_edits = async () => {
  // Closing a source that never loaded must be a no-op, not a crash -- an MCP
  // server that exits before its first tool call still calls `close()`.
  const unused = createResidentGraphSource({ cwd: residentFixture(), mode: "lsp" });
  await unused.close();

  const root = residentFixture();
  const source = createResidentGraphSource({
    cwd: root,
    mode: "lsp",
    languages: ["typescript", "python"],
    server: process.execPath,
    serverArgs: [
      GraphPaths.fakeLspServer,
      "--fail-language=python",
      "--change-symbols-on-refresh",
    ],
    lspTimeoutMs: 2_000,
    lspReadyTimeoutMs: 2_000,
    lspReadyQuietMs: 100,
    lspWarmupTimeoutMs: 5_000,
  });

  const first = await source.load();
  TestValidator.equals("first build mixes lsp and static", first.indexer, "hybrid");
  TestValidator.predicate("first build sees typescript's first symbol", nodeNames(first).includes("FirstHelper"));
  TestValidator.predicate("first build has no second-pass symbol yet", !nodeNames(first).includes("SecondHelper"));
  TestValidator.predicate("first build indexes the static python fallback", first.languages.includes("python"));

  // Loading again with nothing touched must reuse the snapshot rather than
  // re-scanning: the untouched typescript session stays on its first symbol.
  const unchanged = await source.load();
  TestValidator.predicate("an unchanged load does not re-scan", !nodeNames(unchanged).includes("SecondHelper"));

  // Remove a file: the file count drops, tripping the resident source's size
  // check, and the live typescript session must send `didClose` for it.
  fs.rmSync(path.join(root, "src", "e.ts"));
  const afterRemoval = await source.load();
  TestValidator.predicate(
    "removing a file forces a refresh",
    nodeNames(afterRemoval).includes("SecondHelper"),
  );

  // Add a new file (didOpen) and edit an existing one (didChange) in the same
  // round, while a third file is left untouched (no notification at all).
  fs.writeFileSync(path.join(root, "src", "d.ts"), "export function original(): void {}\n");
  fs.writeFileSync(path.join(root, "src", "a.ts"), "export function edited(): void {}\n");
  const afterEdits = await source.load();
  TestValidator.predicate(
    "a new and an edited file both refresh",
    nodeNames(afterEdits).includes("SecondHelper"),
  );

  // Edit an existing file's content without adding or removing any file: the
  // file count stays identical, so staleness can only be detected by finding
  // this one file's mtime changed against the last snapshot. A forced future
  // mtime keeps this deterministic regardless of filesystem clock resolution.
  const bPath = path.join(root, "src", "b.ts");
  fs.writeFileSync(bPath, "export function editedAgain(): void {}\n");
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(bPath, future, future);
  const afterContentOnlyEdit = await source.load();
  TestValidator.predicate(
    "an in-place edit with no count change still forces a refresh",
    nodeNames(afterContentOnlyEdit).includes("SecondHelper"),
  );

  // A final load with no changes must again skip refreshing.
  const settled = await source.load();
  TestValidator.equals("settled dump languages", [...settled.languages].sort(), ["python", "typescript"]);

  await source.close();
};
