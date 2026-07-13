import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";

const warmupFixture = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-warmup-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  for (const name of ["a.ts", "b.ts"]) {
    fs.writeFileSync(
      path.join(root, "src", name),
      "export class LspService {\n  run(): void {\n    helper();\n  }\n}\nconst x = 1;\nexport function helper(): void {}\n",
    );
  }
  return root;
};

export const test_lsp_mode_warms_up_reference_index = async () => {
  // A server that builds its reference index lazily: the FIRST references call
  // is slow past the normal request deadline, but the patient warmup budget
  // lets it finish before the faster batch begins.
  const dump = await buildGraphDump({
    cwd: warmupFixture(),
    mode: "lsp",
    languages: ["typescript"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer, "--slow-first-references=1500"],
    lspTimeoutMs: 500,
    lspWarmupTimeoutMs: 10_000,
    lspConcurrency: 4,
  });

  TestValidator.equals("indexer stays lsp", dump.indexer, "lsp");
  TestValidator.predicate(
    "reference edges were collected after warmup",
    dump.edges.some((edge) => edge.kind === "calls" || edge.kind === "references"),
  );

  const partial = await buildGraphDump({
    cwd: warmupFixture(),
    mode: "lsp",
    languages: ["typescript"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer, "--hang-references-after=1"],
    lspTimeoutMs: 500,
    lspWarmupTimeoutMs: 5_000,
    lspConcurrency: 1,
  });
  TestValidator.equals("partial-timeout graph is still lsp", partial.indexer, "lsp");
  TestValidator.predicate(
    "structure survives a partial reference timeout",
    partial.edges.some((edge) => edge.kind === "contains"),
  );

  const unavailable = await buildGraphDump({
    cwd: warmupFixture(),
    mode: "lsp",
    languages: ["typescript"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer, "--hang-method=textDocument/references"],
    lspTimeoutMs: 500,
    lspWarmupTimeoutMs: 50,
    lspConcurrency: 1,
  });
  TestValidator.equals("warmup timeout keeps the LSP graph", unavailable.indexer, "lsp");
  TestValidator.predicate(
    "warmup timeout keeps structural edges",
    unavailable.edges.some((edge) => edge.kind === "contains"),
  );
  TestValidator.predicate(
    "warmup timeout reports the skipped reference batch",
    unavailable.warnings?.some((warning) => warning.includes("warmup budget")) === true,
  );
};
