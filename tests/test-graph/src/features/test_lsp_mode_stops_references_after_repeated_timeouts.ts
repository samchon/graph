import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";

export const test_lsp_mode_stops_references_after_repeated_timeouts = async () => {
  // Two files so the fake server reports more symbols than the three timeouts
  // that trip the breaker — the remaining targets must be skipped, not asked.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-timeout-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  for (const name of ["a.ts", "b.ts"]) {
    fs.writeFileSync(
      path.join(root, "src", name),
      "export class LspService {\n  run(): void {\n    helper();\n  }\n}\nconst x = 1;\nexport function helper(): void {}\n",
    );
  }
  // The server never answers references, so every request times out. Timeouts
  // must not be retried (each retry burns the full request timeout again), and
  // after a few of them the reference pass must stop asking entirely instead of
  // grinding through every remaining target.
  const started = Date.now();
  const dump = await buildGraphDump({
    cwd: root,
    mode: "lsp",
    languages: ["typescript"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer, "--hang-method=textDocument/references"],
    lspTimeoutMs: 300,
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
    "the breaker reports itself",
    dump.warnings?.some((warning) => warning.includes("repeated timeouts")) === true,
  );
  // 3 timeouts x 300ms, no retries, remaining targets skipped — far below the
  // 9 x 300ms x 3-retry grind the old behavior would have produced.
  TestValidator.predicate("the pass stops instead of grinding", elapsed < 4_000);
};
