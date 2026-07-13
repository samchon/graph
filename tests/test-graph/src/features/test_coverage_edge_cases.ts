import { TestValidator } from "@nestia/e2e";
import { SamchonGraphMemory, LANGUAGE_SPECS, SamchonGraphApplication, buildGraphDump, languageOf } from "@samchon/graph";
import type { ISamchonGraphDump, ISamchonGraphNode } from "@samchon/graph";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { GraphFixtures } from "../internal/GraphFixtures";
import { GraphPaths } from "../internal/GraphPaths";

const importLib = <T>(relative: string): Promise<T> =>
  import(pathToFileURL(path.join(GraphPaths.graphPackageRoot, "lib", relative)).href) as Promise<T>;

export const test_coverage_edge_cases = async () => {
  const orderRoot = GraphFixtures.createOrderFixture();
  const parsed = execFileSync(
    process.execPath,
    [
      GraphPaths.graphBin,
      "dump",
      "--cwd",
      orderRoot,
      "--mode=static",
      "--language=typescript",
      "--language",
      "go",
      "--server=fake-server",
      "--server-arg=one",
      "--server-arg",
      "two",
      "--lsp-concurrency",
      "2",
      "--lsp-ready-quiet-ms=100",
      "--graph-file=ignored-for-dump.json",
    ],
    { encoding: "utf8" },
  );
  TestValidator.equals("CLI parses every supported option form", JSON.parse(parsed).indexer, "static");

  const parsedSeparate = execFileSync(
    process.execPath,
    [
      GraphPaths.graphBin,
      "dump",
      `--cwd=${orderRoot}`,
      "--mode",
      "static",
      "--language",
      "typescript",
      "--server",
      "fake-server",
      "--lsp-concurrency=2",
      "--lsp-ready-quiet-ms",
      "100",
      "--graph-file",
      "ignored-for-dump.json",
    ],
    { encoding: "utf8" },
  );
  TestValidator.equals("CLI parses alternate option forms", JSON.parse(parsedSeparate).indexer, "static");

  for (const args of [
    ["dump", "--language", "brainfuck"],
    ["dump", "--mode=invalid"],
    ["dump", "--lsp-concurrency=0"],
    ["dump", "--lsp-ready-quiet-ms=nan"],
    ["dump", "--server-arg"],
    ["dump", "--unknown"],
  ]) {
    const result = spawnSync(process.execPath, [GraphPaths.graphBin, ...args], {
      encoding: "utf8",
    });
    TestValidator.equals(`CLI rejects ${args.join(" ")}`, result.status, 1);
    TestValidator.predicate("CLI reports package-scoped errors", result.stderr.includes("@samchon/graph:"));
  }

  const { dump } = GraphFixtures.createContractFixture();
  const graph = SamchonGraphMemory.from(dump);
  const app = new SamchonGraphApplication(graph);
  try {
    await app.inspect_code_graph({
      question: "invalid",
      draft: { reason: "invalid", type: "lookup" },
      review: "invalid",
      request: { type: "invalid" },
    } as any);
    throw new Error("Expected invalid graph request to fail.");
  } catch (error) {
    TestValidator.predicate(
      "application rejects unknown request branches",
      error instanceof Error && error.message.includes("Unknown graph request type"),
    );
  }

  const escaped = await app.inspect_code_graph({
    question: "escape without next step",
    draft: { reason: "escape default branch.", type: "escape" },
    review: "escape default branch.",
    request: { type: "escape", reason: "graph evidence is exhausted" },
  });
  TestValidator.equals("escape omits absent nextStep", "nextStep" in escaped.result, false);

  const lspRoot = GraphFixtures.createLspFixture();
  const autoLsp = await buildGraphDump({
    cwd: lspRoot,
    mode: "auto",
    languages: ["typescript"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer, "--stderr"],
  });
  TestValidator.equals("auto mode keeps successful LSP result", autoLsp.indexer, "lsp");

  const discoveredLsp = await buildGraphDump({
    cwd: lspRoot,
    mode: "lsp",
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer],
    lspReferenceLimit: 0,
  });
  TestValidator.predicate("LSP mode can discover project languages", discoveredLsp.nodes.length > 0);

  const multiLspRoot = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-lsp-language-ids-"));
  fs.mkdirSync(path.join(multiLspRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(multiLspRoot, "src", "Entry.cs"), "public class Entry {}\n");
  fs.writeFileSync(path.join(multiLspRoot, "src", "entry.cpp"), "int entry() { return 1; }\n");
  const languageIdDump = await buildGraphDump({
    cwd: multiLspRoot,
    mode: "lsp",
    languages: ["csharp", "cpp"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer],
    lspReferenceLimit: 0,
  });
  TestValidator.equals("LSP language ids cover csharp and cpp", [...languageIdDump.languages].sort(), ["cpp", "csharp"]);

  const symbolInformation = await buildGraphDump({
    cwd: lspRoot,
    mode: "lsp",
    languages: ["typescript"],
    server: process.execPath,
    serverArgs: [
      GraphPaths.fakeLspServer,
      "--bad-header",
      "--bad-json",
      "--unknown-response",
      "--shutdown-error",
      "--symbol-information",
      "--diagnostic-severities=1,2,3,4,0",
    ],
  });
  TestValidator.predicate(
    "LSP survives a malformed JSON frame",
    symbolInformation.indexer === "lsp",
  );
  TestValidator.predicate(
    "LSP SymbolInformation responses are converted",
    symbolInformation.nodes.some((node) => node.qualifiedName === "InformationContainer.LspInformation"),
  );
  TestValidator.equals(
    "all LSP diagnostic severities are normalized",
    symbolInformation.diagnostics?.map((diagnostic) => diagnostic.severity),
    ["error", "warning", "info", "hint", undefined],
  );

  const minimalDiagnostics = await buildGraphDump({
    cwd: lspRoot,
    mode: "lsp",
    languages: ["typescript"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer, "--minimal-diagnostics"],
  });
  TestValidator.equals("minimal diagnostics fall back to an unknown code", minimalDiagnostics.diagnostics?.[0]?.code, "unknown");

  const nullReferences = await buildGraphDump({
    cwd: lspRoot,
    mode: "lsp",
    languages: ["typescript"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer, "--null-references"],
  });
  TestValidator.predicate("LSP accepts null reference responses", nullReferences.nodes.length > 0);

  const specialReferences = await buildGraphDump({
    cwd: lspRoot,
    mode: "lsp",
    languages: ["typescript"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer, "--special-references"],
  });
  TestValidator.equals(
    "LSP skips outside, self, and ownerless references",
    specialReferences.edges.filter((edge) => edge.kind !== "contains"),
    [],
  );

  const nullSymbols = await buildGraphDump({
    cwd: lspRoot,
    mode: "lsp",
    languages: ["typescript"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer, "--null-symbols"],
  });
  TestValidator.equals("null LSP symbols fall back to static", nullSymbols.indexer, "static");

  const omittedChildren = await buildGraphDump({
    cwd: lspRoot,
    mode: "lsp",
    languages: ["typescript"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer, "--omit-children"],
  });
  TestValidator.predicate(
    "LSP document symbols may omit children",
    omittedChildren.nodes.some((node) => node.name === "helper"),
  );

  const unknownParent = await buildGraphDump({
    cwd: lspRoot,
    mode: "lsp",
    languages: ["typescript"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer, "--unknown-parent"],
  });
  TestValidator.predicate(
    "unknown LSP parent kinds do not qualify children",
    unknownParent.nodes.some((node) => node.name === "KnownChild" && node.qualifiedName === undefined),
  );

  const allSymbolKinds = await buildGraphDump({
    cwd: lspRoot,
    mode: "lsp",
    languages: ["typescript"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer, "--all-symbol-kinds"],
    lspReferenceLimit: 0,
  });
  const lspKinds = new Set(allSymbolKinds.nodes.map((node) => node.kind));
  for (const kind of [
    "module",
    "namespace",
    "property",
    "field",
    "constructor",
    "enum",
    "interface",
    "variable",
    "type",
    "external_symbol",
  ] as const) {
    TestValidator.predicate(`LSP maps symbol kind ${kind}`, lspKinds.has(kind));
  }

  const emptySymbols = await buildGraphDump({
    cwd: lspRoot,
    mode: "lsp",
    languages: ["typescript"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer, "--empty-symbols"],
  });
  TestValidator.equals("empty LSP symbols fall back to static", emptySymbols.indexer, "static");
  TestValidator.predicate(
    "empty LSP symbols warning is retained",
    emptySymbols.warnings?.some((warning) => warning.includes("LSP returned no symbols")) === true,
  );

  const absoluteMissing = await buildGraphDump({
    cwd: lspRoot,
    mode: "lsp",
    languages: ["typescript"],
    server: path.join(lspRoot, "missing-language-server.exe"),
  });
  TestValidator.equals("absolute missing LSP server falls back", absoluteMissing.indexer, "static");

  const { LspClient } = await importLib<{
    LspClient: new (
      command: string,
      args: readonly string[],
      timeoutMs?: number,
    ) => {
      request<T>(method: string, params: unknown): Promise<T>;
      close(): Promise<void>;
    };
  }>("lsp/LspClient.js");
  const spawnErrorClient = new LspClient(
    path.join(lspRoot, "missing-direct-language-server.exe"),
    [],
    2_000,
  );
  let spawnError: unknown;
  try {
    await spawnErrorClient.request("initialize", {});
  } catch (error) {
    spawnError = error;
  }
  await spawnErrorClient.close();
  TestValidator.predicate(
    "spawn errors reject and close without waiting for shutdown",
    spawnError instanceof Error,
  );

  const exited = await buildGraphDump({
    cwd: lspRoot,
    mode: "lsp",
    languages: ["typescript"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer, "--exit-on-initialize"],
  });
  TestValidator.equals("exited LSP process falls back", exited.indexer, "static");

  const messageLessError = await buildGraphDump({
    cwd: lspRoot,
    mode: "lsp",
    languages: ["typescript"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer, "--message-less-error"],
  });
  TestValidator.predicate(
    "message-less LSP errors use the default message",
    messageLessError.warnings?.some((warning) => warning.includes("LSP request failed")) === true,
  );

  const slashMissing = await buildGraphDump({
    cwd: lspRoot,
    mode: "lsp",
    languages: ["typescript"],
    server: "./missing-language-server",
  });
  TestValidator.equals("relative slash LSP command falls back", slashMissing.indexer, "static");

  const typescriptSpec = LANGUAGE_SPECS.find((spec) => spec.language === "typescript");
  const originalTypescriptLsp = typescriptSpec?.lsp;
  try {
    if (typescriptSpec !== undefined) delete typescriptSpec.lsp;
    const noConfiguredLsp = await buildGraphDump({
      cwd: lspRoot,
      mode: "lsp",
      languages: ["typescript"],
    });
    TestValidator.equals("missing configured LSP falls back", noConfiguredLsp.indexer, "static");
    TestValidator.predicate(
      "missing configured LSP warning is retained",
      noConfiguredLsp.warnings?.some((warning) => warning.includes("no built-in LSP server")) === true,
    );
  } finally {
    if (typescriptSpec !== undefined) typescriptSpec.lsp = originalTypescriptLsp;
  }

  const staticRoot = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-static-kinds-"));
  fs.mkdirSync(path.join(staticRoot, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(staticRoot, "src", "kinds.ts"),
    [
      "export namespace CoveredNamespace {",
      "  export enum CoveredEnum { One }",
      "  export module CoveredModule {",
      "    export function inside() { return 1; }",
      "  }",
      "}",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(staticRoot, "src", "imports.ts"),
    [
      "import { inside } from \"./kinds\";",
      "const lazy = import(\"./lazy\");",
      "import \"./side\";",
      "export function useImports() { return inside(); }",
    ].join("\n"),
  );
  fs.writeFileSync(path.join(staticRoot, "src", "value.zig"), "const ZigValue = 1;\n");
  fs.writeFileSync(
    path.join(staticRoot, "src", "import.go"),
    [
      "package main",
      "import \"os\"",
      "type Reader interface {",
      "  Read() string",
      "}",
      "const ExportedConst = 1",
      "func UseOs() string {",
      "  return os.Args[0]",
      "}",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(staticRoot, "src", "use.rs"),
    ["use std::fmt;", "pub fn rust_import() -> i32 {", "  1", "}"].join("\n"),
  );
  fs.writeFileSync(
    path.join(staticRoot, "src", "include.c"),
    ["#include <stdio.h>", "int c_import() {", "  return 1;", "}"].join("\n"),
  );
  fs.writeFileSync(
    path.join(staticRoot, "src", "Use.java"),
    ["import java.util.List;", "public class Use {", "}"].join("\n"),
  );
  fs.writeFileSync(path.join(staticRoot, "src", "solo.ts"), "export function Solo() { return 1; }\n");
  const staticKinds = await buildGraphDump({
    cwd: staticRoot,
    mode: "static",
    languages: ["typescript", "zig", "go", "rust", "c", "java"],
  });
  const staticKindSet = new Set(staticKinds.nodes.map((node) => node.kind));
  for (const kind of ["namespace", "enum", "module", "variable"] as const) {
    TestValidator.predicate(`static indexer maps ${kind}`, staticKindSet.has(kind));
  }
  for (const imported of ["./kinds", "./lazy", "./side", "os", "std::fmt", "stdio.h", "java.util.List"]) {
    TestValidator.predicate(
      `static indexer records ${imported} import`,
      staticKinds.nodes.some((node) => node.external && node.name === imported),
    );
  }

  const previousCwd = process.cwd();
  process.chdir(staticRoot);
  try {
    const defaultedDump = await buildGraphDump({ languages: ["zig"], maxFiles: 1 });
    TestValidator.equals("buildGraphDump defaults cwd and mode", defaultedDump.indexer, "static");
  } finally {
    process.chdir(previousCwd);
  }

  const { buildStaticGraph } = await importLib<{
    buildStaticGraph: (options?: { cwd?: string; languages?: string[]; maxFiles?: number }) => ISamchonGraphDump;
  }>("indexer/buildStaticGraph.js");
  const { buildLspGraph } = await importLib<{
    buildLspGraph: (options?: {
      languages?: string[];
      server?: string;
      serverArgs?: string[];
      lspReferenceLimit?: number;
    }) => Promise<{ dump: ISamchonGraphDump }>;
  }>("indexer/buildLspGraph.js");
  process.chdir(staticRoot);
  try {
    TestValidator.equals("buildStaticGraph defaults cwd", buildStaticGraph({ languages: ["zig"], maxFiles: 1 }).indexer, "static");
  } finally {
    process.chdir(previousCwd);
  }
  process.chdir(lspRoot);
  try {
    const defaultLspGraph = await buildLspGraph({
      languages: ["typescript"],
      server: process.execPath,
      serverArgs: [GraphPaths.fakeLspServer],
      lspReferenceLimit: 0,
    });
    TestValidator.predicate("buildLspGraph defaults cwd", defaultLspGraph.dump.nodes.length > 0);
  } finally {
    process.chdir(previousCwd);
  }
  const importLimitRoot = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-import-limit-"));
  fs.mkdirSync(path.join(importLimitRoot, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(importLimitRoot, "src", "imports.ts"),
    Array.from({ length: 1_502 }, (_, index) => `import "pkg-${index}";`).join("\n"),
  );
  const limitedImports = buildStaticGraph({ cwd: importLimitRoot, languages: ["typescript"] });
  TestValidator.equals(
    "static indexer caps external import nodes",
    limitedImports.nodes.filter((node) => node.external).length,
    1_500,
  );

  const lookup = await app.inspect_code_graph({
    question: "empty lookup",
    draft: { reason: "empty query branch.", type: "lookup" },
    review: "empty query branch.",
    request: { type: "lookup", query: "   " },
  });
  TestValidator.equals("empty lookup returns no hits", (lookup.result as any).hits.length, 0);

  const missingTrace = await app.inspect_code_graph({
    question: "missing trace",
    draft: { reason: "missing start branch.", type: "trace" },
    review: "missing start branch.",
    request: { type: "trace", from: "missing" },
  });
  TestValidator.equals("missing trace start resolves to no node", (missingTrace.result as any).start, undefined);

  const missingPathTarget = await app.inspect_code_graph({
    question: "missing path target",
    draft: { reason: "missing path target branch.", type: "trace" },
    review: "missing path target branch.",
    request: { type: "trace", from: "Root.Service.run", to: "missing" },
  });
  TestValidator.equals("missing trace target returns empty path result", missingPathTarget.result.direction, "path");

  const truncatedTrace = await app.inspect_code_graph({
    question: "truncated trace",
    draft: { reason: "max node truncation branch.", type: "trace" },
    review: "max node truncation branch.",
    request: { type: "trace", from: "Root.Service.run", maxNodes: 1, maxDepth: 4 },
  });
  TestValidator.equals("trace reports truncation", truncatedTrace.result.truncated, true);

  for (const aspect of ["layers", "hotspots", "publicApi", "diagnostics"] as const) {
    const overview = await app.inspect_code_graph({
      question: `overview ${aspect}`,
      draft: { reason: "single aspect branch.", type: "overview" },
      review: "single aspect branch.",
      request: { type: "overview", aspect },
    });
    TestValidator.equals(`overview ${aspect} result type`, overview.result.type, "overview");
  }

  const branchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-branches-"));
  fs.mkdirSync(path.join(branchRoot, "src"), { recursive: true });
  fs.mkdirSync(path.join(branchRoot, "test"), { recursive: true });
  fs.writeFileSync(
    path.join(branchRoot, "src", "a.ts"),
    [
      "export class Exact {",
      "  noEvidence() {",
      "    return 1;",
      "  }",
      "  withSignature(",
      "    input: string",
      "  ) {",
      "    return input;",
      "  }",
      "}",
      "export function duplicate() { return 1; }",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(branchRoot, "src", "b.ts"),
    [
      "export function duplicate() { return 2; }",
      "function plain() { return 3; }",
    ].join("\n"),
  );
  fs.writeFileSync(path.join(branchRoot, "test", "impact.spec.ts"), "export function impactSpec() {}\n");

  const branchEvidence = (file: string, startLine: number, endLine?: number) => ({
    file,
    startLine,
    ...(endLine !== undefined ? { endLine } : {}),
  });
  const branchNode = (
    id: string,
    kind: ISamchonGraphNode["kind"],
    name: string,
    file: string,
    extra: Partial<ISamchonGraphNode> = {},
  ): ISamchonGraphNode => ({
    id,
    kind,
    language: "typescript",
    name,
    file,
    external: false,
    ...extra,
  });
  const exactId = "src/a.ts#Exact:class";
  const noEvidenceId = "src/a.ts#Exact.noEvidence:method";
  const withSignatureId = "src/a.ts#Exact.withSignature:method";
  const duplicateAId = "src/a.ts#duplicate:function";
  const duplicateBId = "src/b.ts#duplicate:function";
  const plainId = "src/b.ts#plain:function";
  const impactId = "test/impact.spec.ts#impactSpec:function";
  const fullEvidence = {
    file: "src/a.ts",
    startLine: 2,
    startCol: 3,
    endLine: 2,
    endCol: 15,
  };
  const branchDump: ISamchonGraphDump = {
    project: branchRoot,
    languages: ["typescript"],
    generatedAt: new Date(0).toISOString(),
    indexer: "static",
    nodes: [
      branchNode(exactId, "class", "Exact", "src/a.ts", {
        exported: true,
        evidence: branchEvidence("src/a.ts", 1, 10),
        implementation: {
          file: "src/a.ts",
          startLine: 1,
          startCol: 1,
          endLine: 10,
          endCol: 2,
        },
      }),
      branchNode(noEvidenceId, "method", "noEvidence", "src/a.ts"),
      branchNode(withSignatureId, "method", "withSignature", "src/a.ts", {
        qualifiedName: "Exact.withSignature",
        evidence: branchEvidence("src/a.ts", 5, 7),
      }),
      branchNode(duplicateAId, "function", "duplicate", "src/a.ts", {
        exported: true,
        evidence: branchEvidence("src/a.ts", 11),
      }),
      branchNode(duplicateBId, "function", "duplicate", "src/b.ts", {
        exported: true,
        evidence: branchEvidence("src/b.ts", 1),
      }),
      branchNode(plainId, "function", "plain", "src/b.ts", {
        exported: false,
        evidence: branchEvidence("src/b.ts", 2),
      }),
      branchNode("src/b.ts#ignored:function", "function", "ignored", "src/b.ts", {
        evidence: branchEvidence("src/b.ts", 2),
        ignored: true,
      }),
      branchNode(impactId, "function", "impactSpec", "test/impact.spec.ts", {
        exported: true,
        evidence: branchEvidence("test/impact.spec.ts", 1),
      }),
      {
        id: "external:branch",
        kind: "external_symbol",
        language: "typescript",
        name: "ExternalBranch",
        file: "",
        external: true,
      },
    ],
    edges: [
      { from: "src/a.ts", to: exactId, kind: "contains" },
      { from: "src/a.ts", to: exactId, kind: "exports" },
      { from: exactId, to: noEvidenceId, kind: "contains" },
      { from: exactId, to: withSignatureId, kind: "contains" },
      { from: exactId, to: duplicateAId, kind: "calls", evidence: fullEvidence },
      { from: exactId, to: duplicateAId, kind: "calls", evidence: fullEvidence },
      { from: exactId, to: duplicateBId, kind: "type_ref" },
      { from: exactId, to: "missing-node", kind: "calls", evidence: fullEvidence },
      { from: exactId, to: "external:branch", kind: "calls", evidence: fullEvidence },
      { from: duplicateAId, to: duplicateBId, kind: "references", evidence: branchEvidence("src/a.ts", 11) },
      { from: duplicateBId, to: duplicateAId, kind: "references" },
      { from: impactId, to: exactId, kind: "tests", evidence: branchEvidence("test/impact.spec.ts", 1) },
      { from: plainId, to: exactId, kind: "references", evidence: branchEvidence("src/b.ts", 2) },
    ],
  };
  const branchGraph = SamchonGraphMemory.from(branchDump);
  TestValidator.equals("missing incoming edges default to empty", branchGraph.incoming("absent-node"), []);
  TestValidator.equals("missing named nodes default to empty", branchGraph.named("absent"), []);

  const branchApp = new SamchonGraphApplication(branchGraph);
  const branchDetails = await branchApp.inspect_code_graph({
    question: "branch details",
    draft: { reason: "details branch coverage.", type: "details" },
    review: "details branch coverage.",
    request: {
      type: "details",
      handles: [exactId, "missing-handle"],
      neighbors: true,
      memberLimit: 4,
      dependencyLimit: 4,
    },
  });
  const detail = (branchDetails.result as any).nodes[0];
  TestValidator.equals("details reports unknown handles", (branchDetails.result as any).unknown, ["missing-handle"]);
  TestValidator.equals("details keeps implementation end line", detail.implementation.endLine, 10);
  TestValidator.equals("details de-duplicates call references", detail.calls.length, 1);
  TestValidator.predicate(
    "details can render members without evidence",
    detail.members.some((member: any) => member.name === "noEvidence" && member.line === undefined),
  );
  TestValidator.predicate(
    "details can derive member signatures from evidence",
    detail.members.some((member: any) => member.name === "Exact.withSignature" && typeof member.signature === "string"),
  );

  const ambiguousTrace = await branchApp.inspect_code_graph({
    question: "ambiguous trace",
    draft: { reason: "ambiguous symbol branch.", type: "trace" },
    review: "ambiguous symbol branch.",
    request: { type: "trace", from: "duplicate" },
  });
  TestValidator.equals("ambiguous symbol returns candidates", (ambiguousTrace.result as any).candidates.length, 2);

  const emptyHandleTrace = await branchApp.inspect_code_graph({
    question: "empty trace handle",
    draft: { reason: "empty handle branch.", type: "trace" },
    review: "empty handle branch.",
    request: { type: "trace", from: "   " },
  });
  TestValidator.equals("empty trace handle resolves to no node", (emptyHandleTrace.result as any).start, undefined);

  const fuzzyTrace = await branchApp.inspect_code_graph({
    question: "fuzzy trace",
    draft: { reason: "single fuzzy branch.", type: "trace" },
    review: "single fuzzy branch.",
    request: { type: "trace", from: "impact.spec.ts" },
  });
  TestValidator.equals("single fuzzy file suffix resolves", (fuzzyTrace.result as any).start.id, impactId);

  const fuzzyAmbiguousTrace = await branchApp.inspect_code_graph({
    question: "ambiguous fuzzy trace",
    draft: { reason: "ambiguous fuzzy branch.", type: "trace" },
    review: "ambiguous fuzzy branch.",
    request: { type: "trace", from: "a.ts" },
  });
  TestValidator.predicate("ambiguous fuzzy suffix returns candidates", (fuzzyAmbiguousTrace.result as any).candidates.length > 1);

  const noPathTrace = await branchApp.inspect_code_graph({
    question: "no path trace",
    draft: { reason: "existing target without path.", type: "trace" },
    review: "existing target without path.",
    request: { type: "trace", from: duplicateAId, to: impactId },
  });
  TestValidator.equals("existing target without path returns empty path", (noPathTrace.result as any).path, []);

  const skippedPathTrace = await branchApp.inspect_code_graph({
    question: "skipped path trace",
    draft: { reason: "path skip branches.", type: "trace" },
    review: "path skip branches.",
    request: { type: "trace", from: exactId, to: impactId },
  });
  TestValidator.equals("path search skips missing and external nodes", (skippedPathTrace.result as any).path, []);

  const impactTrace = await branchApp.inspect_code_graph({
    question: "impact roles",
    draft: { reason: "impact roles branch.", type: "trace" },
    review: "impact roles branch.",
    request: { type: "trace", from: exactId, direction: "impact", maxDepth: 1 },
  });
  TestValidator.predicate(
    "impact trace marks exported test roles",
    (impactTrace.result as any).reached.some((node: any) => node.id === impactId && node.roles.includes("test")),
  );
  TestValidator.predicate(
    "impact trace omits empty roles",
    (impactTrace.result as any).reached.some((node: any) => node.id === plainId && node.roles === undefined),
  );

  const typeTrace = await branchApp.inspect_code_graph({
    question: "type trace",
    draft: { reason: "type focus branch.", type: "trace" },
    review: "type focus branch.",
    request: { type: "trace", from: exactId, focus: "types", maxDepth: 1 },
  });
  TestValidator.predicate(
    "trace can focus on type edges",
    (typeTrace.result as any).reached.some((node: any) => node.id === duplicateBId),
  );

  const noEvidenceHopTrace = await branchApp.inspect_code_graph({
    question: "no evidence hop",
    draft: { reason: "hop without evidence branch.", type: "trace" },
    review: "hop without evidence branch.",
    request: { type: "trace", from: duplicateBId, maxDepth: 1 },
  });
  TestValidator.predicate(
    "trace steps omit location text for hops without evidence",
    (noEvidenceHopTrace.result as any).steps.some((step: string) => !step.includes(" at ")),
  );

  const fileLookup = await branchApp.inspect_code_graph({
    question: "file lookup",
    draft: { reason: "file suffix scoring branch.", type: "lookup" },
    review: "file suffix scoring branch.",
    request: { type: "lookup", query: "src/a.ts" },
  });
  TestValidator.predicate("lookup scores file suffixes", (fileLookup.result as any).hits.length > 0);

  const ignoredLookup = await branchApp.inspect_code_graph({
    question: "ignored lookup",
    draft: { reason: "ignored score branch.", type: "lookup" },
    review: "ignored score branch.",
    request: { type: "lookup", query: "ignored" },
  });
  TestValidator.predicate("lookup still returns ignored low score hits", (ignoredLookup.result as any).hits.length > 0);

  const directEntrypoint = await branchApp.inspect_code_graph({
    question: "direct entrypoint",
    draft: { reason: "backtick direct mention branch.", type: "entrypoints" },
    review: "backtick direct mention branch.",
    request: { type: "entrypoints", query: `inspect \`${exactId}\`` },
  });
  TestValidator.equals("entrypoints include direct backtick mention", (directEntrypoint.result as any).mentions[0].node.id, exactId);

  const defaultTour = await branchApp.inspect_code_graph({
    question: "default tour",
    draft: { reason: "default tour question branch.", type: "tour" },
    review: "default tour question branch.",
    request: { type: "tour", query: "default tour question branch." },
  });
  TestValidator.equals(
    "tour preserves the caller's query",
    (defaultTour.result as any).query,
    "default tour question branch.",
  );

  const { fileFromUri } = await importLib<{ fileFromUri: (uri: string) => string }>("utils/fileFromUri.js");
  TestValidator.equals("non-file URI returns as-is", fileFromUri("untouched"), "untouched");
  TestValidator.equals("file URI decodes slash paths", fileFromUri("file:///tmp/samchon%20graph"), "/tmp/samchon graph");
  TestValidator.equals("file URI decodes encoded drive colon", fileFromUri("file:///c%3A/repo/app.ts"), "c:\\repo\\app.ts");
  TestValidator.equals("file URI restores encoded hash", fileFromUri("file:///tmp/a%23b.ts"), "/tmp/a#b.ts");
  TestValidator.equals("file URI decodes uppercase encoded drive colon", fileFromUri("file:///D%3A/repo/app.ts"), "D:\\repo\\app.ts");
  TestValidator.equals("file URI keeps plain drive colon", fileFromUri("file:///C:/repo/app.ts"), "C:\\repo\\app.ts");

  const { readText } = await importLib<{ readText: (file: string) => string | undefined }>("utils/readText.js");
  TestValidator.equals("missing text file returns undefined", readText(path.join(orderRoot, "missing.ts")), undefined);

  const { walkSourceFiles } = await importLib<{
    walkSourceFiles: (root: string, options: { extensions: Set<string>; maxFiles?: number }) => string[];
  }>("utils/walkSourceFiles.js");
  TestValidator.equals("missing walk root returns no files", walkSourceFiles(path.join(orderRoot, "missing"), { extensions: new Set([".ts"]) }), []);
  TestValidator.equals("zero maxFiles exits traversal immediately", walkSourceFiles(orderRoot, { extensions: new Set([".ts"]), maxFiles: 0 }), []);
  TestValidator.equals("walk stops after reaching maxFiles", walkSourceFiles(orderRoot, { extensions: new Set([".ts", ".go"]), maxFiles: 1 }).length, 1);
  TestValidator.equals("walk finds matching source files", walkSourceFiles(orderRoot, { extensions: new Set([".ts", ".go"]) }).length >= 1, true);

  const signatureFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "samchon-signature-")), "sample.ts");
  fs.writeFileSync(signatureFile, ["export function sample(", "  input: string", ") {", "  return input;", "}"].join("\n"));
  try {
    fs.symlinkSync(signatureFile, path.join(path.dirname(signatureFile), "sample-link.ts"));
    TestValidator.equals("walk skips non-regular entries", walkSourceFiles(path.dirname(signatureFile), { extensions: new Set([".ts"]) }).length, 1);
  } catch {
    // Windows without Developer Mode may deny symlink creation.
  }
  const { signatureOf } = await importLib<{
    signatureOf: (project: string, node: { file: string; name: string; external: boolean; evidence?: { file: string; startLine: number; endLine?: number }; signature?: string }) => string | undefined;
  }>("operations/signatureOf.js");
  TestValidator.equals("blank explicit signature falls back to source span", signatureOf(path.dirname(signatureFile), {
    external: false,
    file: "sample.ts",
    name: "sample",
    signature: "   ",
    evidence: { file: "sample.ts", startLine: 1 },
  })?.includes("export function sample("), true);
  TestValidator.equals("explicit signature endLine caps source span", signatureOf(path.dirname(signatureFile), {
    external: false,
    file: "sample.ts",
    name: "sample",
    evidence: { file: "sample.ts", startLine: 1, endLine: 3 },
  })?.includes(") {"), true);
  TestValidator.equals("missing signature source file returns undefined", signatureOf(path.dirname(signatureFile), {
    external: false,
    file: "missing.ts",
    name: "missing",
    evidence: { file: "missing.ts", startLine: 1 },
  }), undefined);
  const emptySignatureFile = path.join(path.dirname(signatureFile), "empty.ts");
  fs.writeFileSync(emptySignatureFile, "");
  TestValidator.equals("empty signature source span returns undefined", signatureOf(path.dirname(signatureFile), {
    external: false,
    file: "empty.ts",
    name: "empty",
    evidence: { file: "empty.ts", startLine: 1 },
  }), undefined);
  TestValidator.equals("missing signature evidence returns undefined", signatureOf(path.dirname(signatureFile), {
    external: false,
    file: "",
    name: "missing",
  }), undefined);

  const { basename } = await importLib<{ basename: (file: string) => string }>("utils/basename.js");
  const { dirname } = await importLib<{ dirname: (file: string) => string }>("utils/dirname.js");
  TestValidator.equals("basename handles bare filenames", basename("file.ts"), "file.ts");
  TestValidator.equals("dirname handles bare filenames", dirname("file.ts"), ".");

  const { publicEvidence } = await importLib<{
    publicEvidence: (evidence: { file: string; startLine: number; startCol?: number; endLine?: number; endCol?: number }) => Record<string, unknown>;
  }>("operations/common.js");
  TestValidator.equals("public evidence preserves optional columns", publicEvidence(fullEvidence).endCol, 15);

  TestValidator.equals("languageOf maps headers to c", languageOf("include/value.h"), "c");
  TestValidator.equals("languageOf maps unknown extensions", languageOf("README.md"), "unknown");
};
