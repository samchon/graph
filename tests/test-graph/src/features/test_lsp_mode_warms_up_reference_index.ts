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
  // is slow (past the per-request timeout) but every later call is instant. The
  // old "fire the whole batch cold, give up after 3 timeouts" logic would have
  // collected nothing. The warmup request must wait the first call out under
  // the patient budget, after which the batch resolves and reference edges land.
  const dump = await buildGraphDump({
    cwd: warmupFixture(),
    mode: "lsp",
    languages: ["typescript"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer, "--slow-first-references=1500"],
    lspTimeoutMs: 500, // the batch's normal budget — far below the first-call delay
    lspWarmupTimeoutMs: 10_000, // patient enough to outlast the lazy first build
    lspConcurrency: 4,
  });

  TestValidator.equals("indexer stays lsp", dump.indexer, "lsp");
  TestValidator.predicate(
    "reference edges were collected after warmup",
    dump.edges.some((edge) => edge.kind === "calls" || edge.kind === "references"),
  );
  TestValidator.predicate(
    "no warmup-failure warning when references succeed",
    (dump.warnings ?? []).every((warning) => !warning.includes("warmup budget")),
  );

  // A warm server that still times out on later targets: the warmup call
  // succeeds, so references stay "available", but the batch requests hang and
  // are individually skipped (null) rather than failing the language.
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
  TestValidator.predicate(
    "a warm-then-timeout server is not marked unavailable",
    (partial.warnings ?? []).every((warning) => !warning.includes("warmup budget")),
  );
};
