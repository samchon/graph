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
  // ttsc marks a node exported only when it is in the file's module export
  // table: a class member never is, a top-level declaration is only when the
  // file actually exports it (an inline modifier, a separate `export { }`
  // list, or a default export).
  const exportedOf = (predicate: (node: (typeof dump.nodes)[number]) => boolean) =>
    dump.nodes.find(predicate)?.exported;
  TestValidator.equals(
    "a default-exported top-level class is exported",
    exportedOf((node) => node.name === "LspService"),
    true,
  );
  TestValidator.equals(
    "a list-exported top-level function is exported",
    exportedOf((node) => node.name === "helper"),
    true,
  );
  TestValidator.equals(
    "a class member is never a module export",
    exportedOf((node) => node.qualifiedName === "LspService.run"),
    undefined,
  );
  TestValidator.predicate(
    "LSP references become graph edges classified by the call site",
    dump.edges.some(
      (edge) =>
        edge.kind === "calls" &&
        edge.from.includes("LspService.run") &&
        edge.to.includes("helper"),
    ),
  );
  TestValidator.predicate(
    "LSP nesting becomes contains edges",
    dump.edges.some(
      (edge) =>
        edge.kind === "contains" &&
        edge.from.includes("LspService") &&
        edge.to.includes("LspService.run"),
    ),
  );
  TestValidator.predicate(
    "LSP diagnostics are captured",
    dump.diagnostics?.some(
      (diagnostic) =>
        diagnostic.code === "FAKE001" &&
        diagnostic.severity === "warning",
    ) === true,
  );

  // A server that reports `$/progress` is awaited until it stays quiet, and the
  // references it can answer once indexing settles still become edges.
  const progressDump = await buildGraphDump({
    cwd: root,
    mode: "lsp",
    languages: ["typescript"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer, "--progress"],
    lspReferenceLimit: 10,
    lspReadyQuietMs: 600,
  });
  TestValidator.predicate(
    "progress-reporting server still yields reference edges",
    progressDump.edges.some((edge) => edge.kind === "calls"),
  );

  // The overall readiness cap releases the wait even while progress keeps
  // arriving, and reference collection still runs.
  const cappedDump = await buildGraphDump({
    cwd: root,
    mode: "lsp",
    languages: ["typescript"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer, "--progress"],
    lspReferenceLimit: 10,
    lspReadyQuietMs: 100_000,
    lspReadyTimeoutMs: 200,
  });
  TestValidator.equals("readiness cap keeps LSP indexer", cappedDump.indexer, "lsp");
};
