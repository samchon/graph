import { TestValidator } from "@nestia/e2e";
import { createResidentGraphSource } from "@samchon/graph";
import fs from "node:fs";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";

export const test_resident_graph_source_closes_sessions_on_empty_results = async () => {
  const root = GraphPaths.createTempDirectory("samchon-graph-resident-empty-");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "src", "a.ts"),
    "export function original(): void {}\n",
  );

  // A language server that answers every request but reports zero symbols:
  // the resident source's build falls back to static for it and must close
  // the now-useless live session immediately rather than holding it open.
  const source = createResidentGraphSource({
    cwd: root,
    mode: "lsp",
    languages: ["typescript"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer, "--empty-symbols"],
    lspTimeoutMs: 2_000,
    lspReadyTimeoutMs: 2_000,
    lspReadyQuietMs: 100,
  });

  const dump = await source.load();
  TestValidator.equals("an all-empty lsp result falls back to static", dump.indexer, "static");

  // An all-static build has no language server to publish a diagnostic, so its
  // dump omits `diagnostics` entirely — the field is genuinely optional. The
  // refresh path used to assert it, and threw on the first edit of any project
  // with no language server installed: the graph never re-synced, and the audit's
  // "the snapshot this call synced to" became a lie backed by a crash. It is the
  // commonest configuration there is, and it is the one that was broken.
  TestValidator.equals(
    "an all-static dump carries no diagnostics field",
    dump.diagnostics,
    undefined,
  );
  fs.writeFileSync(
    path.join(root, "src", "a.ts"),
    "export function edited(): void {}\n",
  );
  const refreshed = await source.load();
  TestValidator.predicate(
    "and an edit to it refreshes the graph rather than throwing",
    refreshed.nodes.some((node) => node.name === "edited"),
  );

  // Closing must be a no-op here: the empty-result session was already
  // closed during the build, so nothing was kept alive to close again.
  await source.close();

  // A project with no source files at all: no language is even attempted, so
  // the build falls straight to the empty-project static branch. Resident
  // mode must still return cleanly, without a session to hold or close.
  const bareRoot = GraphPaths.createTempDirectory("samchon-graph-resident-bare-");
  const bareSource = createResidentGraphSource({
    cwd: bareRoot,
    mode: "lsp",
    languages: ["typescript"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer],
  });
  const bareDump = await bareSource.load();
  TestValidator.equals("a project with no source files falls back to static", bareDump.indexer, "static");
  await bareSource.close();

  // Omitting `cwd` falls back to the process's own working directory; never
  // loading means this never actually indexes it.
  const defaultCwdSource = createResidentGraphSource({});
  await defaultCwdSource.close();
};
