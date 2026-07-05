const fs = require("node:fs");
const path = require("node:path");
const { TestValidator } = require("@nestia/e2e");
const { buildGraphDump } = require("../../../lib");
const { createLspFixture } = require("../internal/fixtures.ts");

exports.test_lsp_mode_collects_symbols_references_and_diagnostics = async () => {
  const root = createLspFixture();
  const server = path.join(process.cwd(), "test", "src", "internal", "fake-lsp-server.cjs");
  const dump = await buildGraphDump({
    cwd: root,
    mode: "lsp",
    languages: ["typescript"],
    server: process.execPath,
    serverArgs: [server],
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

exports.test_auto_mode_falls_back_to_static_when_lsp_is_missing = async () => {
  const root = createLspFixture();
  const dump = await buildGraphDump({
    cwd: root,
    mode: "auto",
    languages: ["typescript"],
    server: "samchon-graph-missing-language-server",
  });

  TestValidator.equals("missing LSP falls back to static", dump.indexer, "static");
  TestValidator.predicate(
    "fallback warning names missing server",
    dump.warnings?.some((warning) =>
      warning.includes("samchon-graph-missing-language-server"),
    ) === true,
  );
  TestValidator.predicate(
    "fallback still indexes source",
    dump.nodes.some((node) => node.name === "LspService"),
  );
};

exports.test_lsp_mode_handles_empty_projects_through_static_warning = async () => {
  const root = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "samchon-empty-lsp-"));
  const dump = await buildGraphDump({
    cwd: root,
    mode: "lsp",
    languages: ["typescript"],
    server: process.execPath,
    serverArgs: [path.join(process.cwd(), "test", "src", "internal", "fake-lsp-server.cjs")],
  });

  TestValidator.equals("empty lsp project returns static fallback", dump.indexer, "static");
  TestValidator.predicate(
    "empty project warning is retained",
    dump.warnings?.some((warning) => warning.includes("No supported source files")) === true,
  );
};
