import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { GraphFixtures } from "../internal/GraphFixtures";
import { GraphPaths } from "../internal/GraphPaths";

export const test_lsp_mode_spawns_cmd_shim_servers = async () => {
  const root = GraphFixtures.createLspFixture();

  // A bare command name must resolve through PATH lookup on every platform;
  // `node` exists everywhere and runs the fake server directly.
  const bare = await buildGraphDump({
    cwd: root,
    mode: "lsp",
    languages: ["typescript"],
    server: "node",
    serverArgs: [GraphPaths.fakeLspServer],
    lspReferenceLimit: 10,
  });
  TestValidator.equals("bare command resolves through PATH", bare.indexer, "lsp");
  // npm installs Windows language servers as .cmd shims; CreateProcess cannot
  // spawn those directly, so the indexer must route them through cmd.exe. The
  // shim wraps the fake LSP server: on Windows the graph must come back real;
  // elsewhere cmd.exe does not exist and the language must fall back cleanly.
  const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-shim-"));
  const shim = path.join(shimDir, "fake-server.cmd");
  fs.writeFileSync(shim, `@echo off\r\nnode "${GraphPaths.fakeLspServer}" %*\r\n`);

  const dump = await buildGraphDump({
    cwd: root,
    mode: "lsp",
    languages: ["typescript"],
    server: shim,
    lspReferenceLimit: 10,
  });

  if (process.platform === "win32") {
    TestValidator.equals("cmd shim serves a real LSP graph", dump.indexer, "lsp");
    TestValidator.predicate(
      "shim-served symbols are indexed",
      dump.nodes.some((node) => node.name === "LspService"),
    );
  } else {
    TestValidator.equals("without cmd.exe the language falls back", dump.indexer, "static");
    TestValidator.predicate(
      "the fallback names the failure",
      dump.warnings?.some((warning) => warning.includes("LSP indexing failed")) === true,
    );
  }
};
