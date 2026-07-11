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
  // is slow but every later call is instant. There is no per-request timeout,
  // so the warmup request simply waits the first call out, after which the
  // batch resolves and reference edges land.
  const dump = await buildGraphDump({
    cwd: warmupFixture(),
    mode: "lsp",
    languages: ["typescript"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer, "--slow-first-references=1500"],
    lspConcurrency: 4,
  });

  TestValidator.equals("indexer stays lsp", dump.indexer, "lsp");
  TestValidator.predicate(
    "reference edges were collected after warmup",
    dump.edges.some((edge) => edge.kind === "calls" || edge.kind === "references"),
  );
};
