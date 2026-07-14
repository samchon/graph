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

  // §1c: the audit that rides on every result swears the facts were resolved
  // "for the snapshot this call synced to", and that sentence is only true if
  // the server can actually tell that the snapshot moved. This is the edit that
  // proves it: the same file, rewritten to the SAME BYTE LENGTH, with its mtime
  // put back exactly where it was. Nothing about the file's metadata changed —
  // not its count, not its size, not its timestamp. Only its contents did.
  //
  // A freshness check built on mtime (or on mtime plus size) misses this edit
  // and serves a graph of code that no longer exists, under an audit that swears
  // it is current. A content hash cannot.
  const bPath = path.join(root, "src", "b.ts");
  const original = fs.readFileSync(bPath, "utf8");
  // Pin the timestamp to a fixed instant on both sides of the edit, so the
  // "nothing about the metadata moved" claim below is exact rather than a race
  // against the filesystem's clock resolution.
  const pinned = new Date(2020, 0, 1);
  fs.utimesSync(bPath, pinned, pinned);
  await source.load();
  const before = fs.statSync(bPath);

  const head = "export function edited2(): void {}\n";
  fs.writeFileSync(bPath, `${head}${" ".repeat(original.length - head.length)}`);
  fs.utimesSync(bPath, pinned, pinned);
  const after = fs.statSync(bPath);
  TestValidator.equals(
    "the edit left the file's size and timestamp byte-identical",
    [after.size, after.mtimeMs],
    [before.size, before.mtimeMs],
  );

  const afterContentOnlyEdit = await source.load();
  TestValidator.predicate(
    "a same-tick, same-size edit still forces a refresh",
    nodeNames(afterContentOnlyEdit).includes("SecondHelper"),
  );

  // A final load with no changes must again skip refreshing.
  const settled = await source.load();
  TestValidator.equals("settled dump languages", [...settled.languages].sort(), ["python", "typescript"]);

  // §6a, on the one part of the dump a resident session is tempted to accumulate.
  // A `publishDiagnostics` notification is a *replacement* for the document it
  // names, so the session holds them per file: what the server says about a file
  // it re-analysed replaces what it said before, and what it said about a file
  // that is gone from disk goes with the file. Appending instead made
  // `diagnostics` a function of the session's edit history — `src/e.ts` was
  // deleted several loads ago, and its findings would still be here.
  const diagnosed = [...new Set((settled.diagnostics ?? []).map((d) => d.file))];
  TestValidator.equals(
    "a deleted file's diagnostics go with the file",
    diagnosed.filter((file) => file.endsWith("e.ts")),
    [],
  );
  TestValidator.equals(
    "and a re-analysed file's are replaced, not doubled",
    (settled.diagnostics ?? []).length,
    new Set(
      (settled.diagnostics ?? []).map((d) => `${d.file}:${d.line}:${d.code}`),
    ).size,
  );

  await source.close();
};
