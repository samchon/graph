import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";

import { GraphFixtures } from "../internal/GraphFixtures";

export const test_auto_mode_falls_back_to_static_when_lsp_is_missing = async () => {
  const root = GraphFixtures.createLspFixture();
  const dump = await buildGraphDump({
    cwd: root,
    mode: "auto",
    languages: ["typescript"],
    server: "samchon-graph-missing-language-server",
  });

  TestValidator.equals("missing LSP falls back to static", dump.indexer, "static");
  TestValidator.predicate(
    "fallback warning names missing server",
    dump.warnings?.some((warning) => warning.includes("samchon-graph-missing-language-server")) === true,
  );
  TestValidator.predicate("fallback still indexes source", dump.nodes.some((node) => node.name === "LspService"));
};
