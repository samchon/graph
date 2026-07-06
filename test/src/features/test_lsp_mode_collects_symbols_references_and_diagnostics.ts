import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";

import { GraphFixtures } from "../internal/GraphFixtures";
import { GraphPaths } from "../internal/GraphPaths";

export const test_lsp_mode_collects_symbols_references_and_diagnostics = async () => {
  const root = GraphFixtures.createLspFixture();
  const dump = await buildGraphDump({
    cwd: root,
    mode: "lsp",
    languages: ["typescript"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer],
    lspReferenceLimit: 10,
  });

  TestValidator.equals("LSP dump indexer", dump.indexer, "lsp");
  TestValidator.equals("LSP language list", dump.languages, ["typescript"]);
  TestValidator.predicate(
    "LSP document symbols become nodes",
    dump.nodes.some((node) => node.name === "LspService") &&
      dump.nodes.some((node) => node.qualifiedName === "LspService.run") &&
      dump.nodes.some((node) => node.name === "helper"),
  );
  TestValidator.predicate(
    "LSP references become graph edges",
    dump.edges.some(
      (edge) =>
        edge.kind === "references" &&
        edge.from.includes("LspService.run") &&
        edge.to.includes("helper"),
    ),
  );
  TestValidator.predicate(
    "LSP diagnostics are captured",
    dump.diagnostics?.some(
      (diagnostic) =>
        diagnostic.source === "fake-lsp" &&
        diagnostic.code === "FAKE001" &&
        diagnostic.severity === "warning",
    ) === true,
  );
};
