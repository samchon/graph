import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

  // Go's package surface is lexical: only a top-level identifier whose first
  // rune is uppercase is exported. The LSP lane must preserve that fact just
  // as the static lane does instead of promoting every document symbol to a
  // package export.
  const goRoot = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-lsp-go-"));
  fs.writeFileSync(
    path.join(goRoot, "service.go"),
    [
      "package sample",
      "",
      "type Engine struct{}",
      "",
      "func (*Engine) ServeHTTP() {}",
      "func (*Engine) handleHTTPRequest() {}",
      "",
      "func helper() {}",
      "",
    ].join("\n"),
  );
  const goDump = await buildGraphDump({
    cwd: goRoot,
    mode: "lsp",
    languages: ["go"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer, "--go-receivers"],
    lspReferenceLimit: 0,
  });
  TestValidator.equals(
    "an uppercase Go top-level symbol is exported in the LSP lane",
    goDump.nodes.find((node) => node.name === "Engine")?.exported,
    true,
  );
  TestValidator.equals(
    "a lowercase Go top-level symbol is private in the LSP lane",
    goDump.nodes.find((node) => node.name === "helper")?.exported,
    undefined,
  );
  TestValidator.equals(
    "a receiver method is not itself a package export",
    goDump.nodes.find((node) => node.qualifiedName === "Engine.ServeHTTP")
      ?.exported,
    undefined,
  );
  TestValidator.equals(
    "an uppercase Go receiver method records public package visibility",
    goDump.nodes.find((node) => node.qualifiedName === "Engine.ServeHTTP")
      ?.modifiers,
    ["public"],
  );
  TestValidator.equals(
    "a lowercase Go receiver method records private package visibility",
    goDump.nodes.find(
      (node) => node.qualifiedName === "Engine.handleHTTPRequest",
    )?.modifiers,
    ["private"],
  );
  const goEngine = goDump.nodes.find((node) => node.name === "Engine");
  const goServe = goDump.nodes.find(
    (node) => node.qualifiedName === "Engine.ServeHTTP",
  );
  TestValidator.predicate(
    "a flat gopls receiver method is owned by its receiver type",
    goEngine !== undefined &&
      goServe !== undefined &&
      goDump.edges.some(
        (edge) =>
          edge.kind === "contains" &&
          edge.from === goEngine.id &&
          edge.to === goServe.id,
      ),
  );
  const goInformationDump = await buildGraphDump({
    cwd: goRoot,
    mode: "lsp",
    languages: ["go"],
    server: process.execPath,
    serverArgs: [
      GraphPaths.fakeLspServer,
      "--go-receivers",
      "--symbol-information",
    ],
    lspReferenceLimit: 0,
  });
  TestValidator.equals(
    "flat SymbolInformation preserves public Go receiver visibility",
    goInformationDump.nodes.find(
      (node) => node.qualifiedName === "Engine.ServeHTTP",
    )?.modifiers,
    ["public"],
  );
  TestValidator.equals(
    "flat SymbolInformation preserves private Go receiver visibility",
    goInformationDump.nodes.find(
      (node) => node.qualifiedName === "Engine.handleHTTPRequest",
    )?.modifiers,
    ["private"],
  );
  TestValidator.equals(
    "flat SymbolInformation strips a generic receiver's type arguments",
    goInformationDump.nodes.find(
      (node) => node.qualifiedName === "GenericEngine.ServeHTTP",
    )?.name,
    "ServeHTTP",
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

  // A work-done token remains active across quiet gaps. rust-analyzer can
  // spend several seconds inside Cargo or source-root scanning without a
  // report, and references requested in that gap are valid empty arrays rather
  // than errors. Wait for the token's `end`, not merely for recent activity to
  // go quiet, or the graph silently contains declarations with no runtime
  // edges.
  const lifecycleDump = await buildGraphDump({
    cwd: root,
    mode: "lsp",
    languages: ["typescript"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer, "--progress-lifecycle"],
    lspReferenceLimit: 10,
    lspReadyQuietMs: 100,
  });
  TestValidator.predicate(
    "an active work-done phase survives a gap longer than the quiet threshold",
    lifecycleDump.edges.some((edge) => edge.kind === "calls"),
  );

  const lateLifecycleDump = await buildGraphDump({
    cwd: root,
    mode: "lsp",
    languages: ["typescript"],
    server: process.execPath,
    serverArgs: [
      GraphPaths.fakeLspServer,
      "--late-progress-lifecycle=450",
    ],
    lspReferenceLimit: 10,
    lspReadyQuietMs: 700,
    lspReadyTimeoutMs: 2_000,
  });
  TestValidator.predicate(
    "didOpen readiness catches a lifecycle beginning after the old fixed grace",
    lateLifecycleDump.edges.some((edge) => edge.kind === "calls"),
  );

  const lazyReferenceDump = await buildGraphDump({
    cwd: root,
    mode: "lsp",
    languages: ["typescript"],
    server: process.execPath,
    serverArgs: [
      GraphPaths.fakeLspServer,
      "--reference-progress-lifecycle",
    ],
    lspReferenceLimit: 10,
    lspReadyQuietMs: 100,
    lspReadyTimeoutMs: 2_000,
  });
  TestValidator.predicate(
    "a warm reference that starts indexing is requeried after lifecycle end",
    lazyReferenceDump.edges.some((edge) => edge.kind === "calls"),
  );

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
