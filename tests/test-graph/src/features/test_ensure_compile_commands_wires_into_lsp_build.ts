import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";
import fs from "node:fs";
import path from "node:path";

import { GraphFixtures } from "../internal/GraphFixtures";
import { GraphPaths } from "../internal/GraphPaths";

const fakeCmake = [process.execPath, GraphPaths.fakeCmake];

export const test_ensure_compile_commands_wires_into_lsp_build = async () => {
  const root = GraphFixtures.createCmakeFixture();
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "main.cc"), "int main() { return 0; }\n");

  const argsFile = path.join(root, "fake-lsp-args.json");
  const previousArgsFile = process.env.SAMCHON_GRAPH_FAKE_LSP_ARGS_FILE;
  process.env.SAMCHON_GRAPH_FAKE_LSP_ARGS_FILE = argsFile;
  try {
    const dump = await buildGraphDump({
      cwd: root,
      mode: "lsp",
      languages: ["cpp"],
      server: process.execPath,
      serverArgs: [GraphPaths.fakeLspServer],
      cmakeCommand: fakeCmake,
    });
    TestValidator.equals("cpp LSP build still succeeds", dump.indexer, "lsp");
    const args = JSON.parse(fs.readFileSync(argsFile, "utf8")) as string[];
    TestValidator.predicate(
      "the resolved compile_commands.json directory is passed to the server",
      args.some((arg) => arg.startsWith("--compile-commands-dir=")),
    );
  } finally {
    if (previousArgsFile === undefined) delete process.env.SAMCHON_GRAPH_FAKE_LSP_ARGS_FILE;
    else process.env.SAMCHON_GRAPH_FAKE_LSP_ARGS_FILE = previousArgsFile;
  }
};
