import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";
import fs from "node:fs";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";

export const test_ensure_pub_deps_wires_into_lsp_build = async () => {
  const root = GraphPaths.createTempDirectory("samchon-graph-pub-lsp-");
  fs.writeFileSync(path.join(root, "pubspec.yaml"), "name: fixture\n");
  fs.writeFileSync(path.join(root, "main.dart"), "void main() {}\n");

  const dump = await buildGraphDump({
    cwd: root,
    mode: "lsp",
    languages: ["dart"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer],
    pubCommand: [process.execPath, GraphPaths.fakePub],
  });

  TestValidator.equals("dart LSP build still succeeds", dump.indexer, "lsp");
  TestValidator.predicate(
    "pub get ran for the dart project before indexing",
    fs.existsSync(path.join(root, ".dart_tool", "package_config.json")),
  );
};
