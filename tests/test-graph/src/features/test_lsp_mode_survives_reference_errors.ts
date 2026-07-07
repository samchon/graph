import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";

import { GraphFixtures } from "../internal/GraphFixtures";
import { GraphPaths } from "../internal/GraphPaths";

export const test_lsp_mode_survives_reference_errors = async () => {
  const root = GraphFixtures.createLspFixture();
  // rust-analyzer and friends answer with a ContentModified error while still
  // indexing; a single failed reference request must not drop the whole
  // language to the static fallback.
  const dump = await buildGraphDump({
    cwd: root,
    mode: "lsp",
    languages: ["typescript"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer, "--reference-error"],
    lspReferenceLimit: 10,
  });

  TestValidator.equals("reference errors keep the LSP result", dump.indexer, "lsp");
  TestValidator.predicate("symbols are still indexed", dump.nodes.length > 0);
  // Reference edges are lost for the failed targets, but structural edges remain.
  TestValidator.predicate(
    "structural edges survive",
    dump.edges.some((edge) => edge.kind === "contains"),
  );
  TestValidator.predicate(
    "no reference edges from the failed requests",
    dump.edges.every((edge) => edge.kind !== "references" && edge.kind !== "calls"),
  );
};
