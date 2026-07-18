import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";
import fs from "node:fs";
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

  // `--cwd` names the project whose dependencies define its language-server
  // toolchain. Resolve a bare server from that project's local npm bin and run
  // it in that project even when the graph process was launched elsewhere.
  const projectBin = path.join(root, "node_modules", ".bin");
  fs.mkdirSync(projectBin, { recursive: true });
  const projectServer = path.join(
    projectBin,
    process.platform === "win32" ? "project-local-lsp.cmd" : "project-local-lsp",
  );
  fs.writeFileSync(
    projectServer,
    process.platform === "win32"
      ? `@echo off\r\n"${process.execPath}" "${GraphPaths.fakeLspServer}" %*\r\n`
      : `#!/bin/sh\nexec "${process.execPath}" "${GraphPaths.fakeLspServer}" "$@"\n`,
  );
  if (process.platform !== "win32") fs.chmodSync(projectServer, 0o755);
  const cwdFile = path.join(root, "fake-lsp-cwd.txt");
  const previousCwdFile = process.env.SAMCHON_GRAPH_FAKE_LSP_CWD_FILE;
  process.env.SAMCHON_GRAPH_FAKE_LSP_CWD_FILE = cwdFile;
  try {
    const local = await buildGraphDump({
      cwd: root,
      mode: "lsp",
      languages: ["typescript"],
      server: "project-local-lsp",
      lspReferenceLimit: 10,
    });
    TestValidator.equals(
      "bare server resolves from the target project's npm bin",
      local.indexer,
      "lsp",
    );
    TestValidator.equals(
      "language server runs in the target project",
      fs.readFileSync(cwdFile, "utf8"),
      root,
    );
  } finally {
    if (previousCwdFile === undefined)
      delete process.env.SAMCHON_GRAPH_FAKE_LSP_CWD_FILE;
    else process.env.SAMCHON_GRAPH_FAKE_LSP_CWD_FILE = previousCwdFile;
  }

  // npm installs Windows language servers as .cmd shims; CreateProcess cannot
  // spawn those directly, so the indexer must route them through cmd.exe. The
  // shim wraps the fake LSP server: on Windows the graph must come back real;
  // elsewhere cmd.exe does not exist and the language must fall back cleanly.
  const shimDir = GraphPaths.createTempDirectory("samchon-graph-shim-");
  const shim = path.join(shimDir, "fake-server.cmd");
  fs.writeFileSync(
    shim,
    `@echo off\r\n"${process.execPath}" "${GraphPaths.fakeLspServer}" %*\r\n`,
  );

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

    const ttscserverShim = path.join(shimDir, "ttscserver.cmd");
    const argsFile = path.join(shimDir, "ttscserver-args.json");
    fs.writeFileSync(ttscserverShim, `@echo off\r\nnode "${GraphPaths.fakeLspServer}" %*\r\n`);
    const previousArgsFile = process.env.SAMCHON_GRAPH_FAKE_LSP_ARGS_FILE;
    process.env.SAMCHON_GRAPH_FAKE_LSP_ARGS_FILE = argsFile;
    try {
      const ttscserverDump = await buildGraphDump({
        cwd: root,
        mode: "lsp",
        languages: ["typescript"],
        server: ttscserverShim,
        lspReferenceLimit: 10,
      });
      TestValidator.equals(
        "ttscserver shim serves a real LSP graph",
        ttscserverDump.indexer,
        "lsp",
      );
      const args = JSON.parse(fs.readFileSync(argsFile, "utf8")) as string[];
      TestValidator.equals("ttscserver receives cwd", args.slice(-2), ["--cwd", root]);
    } finally {
      if (previousArgsFile === undefined) delete process.env.SAMCHON_GRAPH_FAKE_LSP_ARGS_FILE;
      else process.env.SAMCHON_GRAPH_FAKE_LSP_ARGS_FILE = previousArgsFile;
    }
  } else {
    TestValidator.equals("without cmd.exe the language falls back", dump.indexer, "static");
    TestValidator.predicate(
      "the fallback names the failure",
      dump.warnings?.some((warning) => warning.includes("LSP indexing failed")) === true,
    );
  }

  const ttscserverShim = path.join(
    shimDir,
    process.platform === "win32" ? "ttscserver.cmd" : "ttscserver",
  );
  const argsFile = path.join(shimDir, "ttscserver-args.json");
  fs.writeFileSync(
    ttscserverShim,
    process.platform === "win32"
      ? `@echo off\r\n"${process.execPath}" "${GraphPaths.fakeLspServer}" %*\r\n`
      : `#!/bin/sh\nexec "${process.execPath}" "${GraphPaths.fakeLspServer}" "$@"\n`,
  );
  if (process.platform !== "win32") fs.chmodSync(ttscserverShim, 0o755);

  const previousArgsFile = process.env.SAMCHON_GRAPH_FAKE_LSP_ARGS_FILE;
  const previousPath = process.env.PATH;
  process.env.SAMCHON_GRAPH_FAKE_LSP_ARGS_FILE = argsFile;
  process.env.PATH = `${shimDir}${path.delimiter}${previousPath ?? ""}`;
  try {
    const ttscserverDump = await buildGraphDump({
      cwd: root,
      mode: "lsp",
      languages: ["typescript"],
      lspReferenceLimit: 10,
    });
    TestValidator.equals(
      "default ttscserver shim serves a real LSP graph",
      ttscserverDump.indexer,
      "lsp",
    );
    const args = JSON.parse(fs.readFileSync(argsFile, "utf8")) as string[];
    TestValidator.equals("ttscserver receives stdio and cwd", args, [
      "--stdio",
      "--cwd",
      root,
    ]);
  } finally {
    if (previousArgsFile === undefined) delete process.env.SAMCHON_GRAPH_FAKE_LSP_ARGS_FILE;
    else process.env.SAMCHON_GRAPH_FAKE_LSP_ARGS_FILE = previousArgsFile;
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  }
};
