import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";

import { GraphFixtures } from "../internal/GraphFixtures";
import { GraphPaths } from "../internal/GraphPaths";

export const test_lsp_mode_preserves_failed_languages_with_static_fallback = async () => {
  const root = GraphFixtures.createOrderFixture();
  const dump = await buildGraphDump({
    cwd: root,
    mode: "lsp",
    languages: ["typescript", "go"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer, "--fail-language=go"],
  });

  TestValidator.equals("mixed LSP/static dump indexer", dump.indexer, "hybrid");
  TestValidator.equals("mixed LSP/static language set", new Set(dump.languages), new Set(["typescript", "go"]));
  TestValidator.predicate(
    "successful language keeps LSP symbols",
    dump.nodes.some((node) => node.language === "typescript" && node.name === "LspService"),
  );
  TestValidator.predicate(
    "failed language falls back to static symbols",
    dump.nodes.some((node) => node.language === "go" && node.name === "LoadOrder"),
  );
  TestValidator.predicate(
    "failed language warning is retained",
    dump.warnings?.some((warning) => warning.includes("go: LSP indexing failed")) === true,
  );
};
