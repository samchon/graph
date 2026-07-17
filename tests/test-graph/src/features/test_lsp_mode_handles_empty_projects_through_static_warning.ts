import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";

export const test_lsp_mode_handles_empty_projects_through_static_warning = async () => {
  const root = GraphPaths.createTempDirectory("samchon-empty-lsp-");
  const dump = await buildGraphDump({
    cwd: root,
    mode: "lsp",
    languages: ["typescript"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer],
  });

  TestValidator.equals("empty lsp project returns static fallback", dump.indexer, "static");
  TestValidator.predicate(
    "empty project warning is retained",
    dump.warnings?.some((warning) => warning.includes("No supported source files")) === true,
  );
};
