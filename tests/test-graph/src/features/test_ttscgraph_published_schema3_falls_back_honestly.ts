import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";
import fs from "node:fs";
import path from "node:path";

import { resolveTtscGraphCommand } from "../../../../packages/graph/src/provider/ttscgraph/resolveTtscGraphCommand";
import { GraphPaths } from "../internal/GraphPaths";

export const test_ttscgraph_published_schema3_falls_back_honestly = async () => {
  const resolved = resolveTtscGraphCommand(GraphPaths.graphPackageRoot);
  TestValidator.predicate(
    "the workspace resolves its published ttscgraph binary",
    resolved !== undefined && resolved.args.length === 0,
  );
  const root = GraphPaths.createTempDirectory("samchon-graph-schema3-real-");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true }, include: ["src/**/*.ts"] }),
  );
  fs.writeFileSync(
    path.join(root, "src", "model.ts"),
    'export type Status = "ready" | "done";\n',
  );

  const previous = process.env.TTSC_GRAPH_BINARY;
  process.env.TTSC_GRAPH_BINARY = resolved!.command;
  try {
    const dump = await buildGraphDump({
      cwd: root,
      mode: "lsp",
      languages: ["typescript"],
    });
    TestValidator.predicate(
      "the published schema 3 snapshot is refused before the LSP fallback",
      dump.warnings?.some(
        (warning) =>
          warning.includes("provider failed") &&
          warning.includes("dump is schema v3, this client reads v5"),
      ) === true &&
        dump.warnings.every(
          (warning) => !warning.includes("schema v3 compatibility snapshot"),
        ),
    );
    TestValidator.predicate(
      "the fallback still returns the project declaration",
      dump.nodes.some((node) => node.name === "Status" && node.kind === "type"),
    );
  } finally {
    if (previous === undefined) delete process.env.TTSC_GRAPH_BINARY;
    else process.env.TTSC_GRAPH_BINARY = previous;
  }
};
