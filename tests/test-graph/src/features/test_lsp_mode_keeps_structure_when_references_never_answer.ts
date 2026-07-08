import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";

export const test_lsp_mode_keeps_structure_when_references_never_answer = async () => {
  // A server that never answers references at all. The single patient warmup
  // request times out, references are declared unavailable, and the structural
  // graph (symbols + containment) is kept — one bounded wait, no per-target
  // grind, no hang.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-warmup-fail-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  for (const name of ["a.ts", "b.ts"]) {
    fs.writeFileSync(
      path.join(root, "src", name),
      "export class LspService {\n  run(): void {\n    helper();\n  }\n}\nconst x = 1;\nexport function helper(): void {}\n",
    );
  }

  const started = Date.now();
  const dump = await buildGraphDump({
    cwd: root,
    mode: "lsp",
    languages: ["typescript"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer, "--hang-method=textDocument/references"],
    lspTimeoutMs: 2_000,
    lspWarmupTimeoutMs: 2_000, // small so the test does not wait the 180s default
    lspConcurrency: 1,
  });
  const elapsed = Date.now() - started;

  TestValidator.equals("timeouts keep the LSP result", dump.indexer, "lsp");
  TestValidator.predicate("symbols are still indexed", dump.nodes.length > 0);
  TestValidator.predicate(
    "structural edges survive",
    dump.edges.some((edge) => edge.kind === "contains"),
  );
  TestValidator.predicate(
    "no reference edges when the server never answers",
    dump.edges.every((edge) => edge.kind !== "calls" && edge.kind !== "references"),
  );
  TestValidator.predicate(
    "the warmup failure reports itself",
    dump.warnings?.some((warning) => warning.includes("warmup budget")) === true,
  );
  // One warmup timeout (2s), not a per-target grind.
  TestValidator.predicate("one bounded warmup, no grind", elapsed < 15_000);
};
