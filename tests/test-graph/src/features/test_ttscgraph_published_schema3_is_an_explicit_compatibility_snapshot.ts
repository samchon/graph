import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";
import fs from "node:fs";
import path from "node:path";

import { resolveTtscGraphCommand } from "../../../../packages/graph/src/provider/ttscgraph/resolveTtscGraphCommand";
import { GraphPaths } from "../internal/GraphPaths";

export const test_ttscgraph_published_schema3_is_an_explicit_compatibility_snapshot =
  async () => {
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
      [
        'export type Status = "ready" | "done";',
        'export enum Phase { Ready = "ready", Done = "done" }',
        'export const options = { host: "localhost", connect() {} };',
      ].join("\n"),
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
        "the published schema 3 provider remains compiler-owned rather than falling back",
        dump.warnings?.some((warning) =>
          warning.includes("schema v3 compatibility snapshot"),
        ) === true &&
          dump.warnings.every(
            (warning) => !warning.includes("bulk indexing failed"),
          ),
      );
      TestValidator.predicate(
        "schema 3 retains its compiler-resolved literal facts",
        dump.nodes.some(
          (node) =>
            node.name === "Status" &&
            node.literals?.includes('"ready"') === true,
        ),
      );
      TestValidator.equals(
        "schema 3 does not fabricate schema 5 object-member facts",
        dump.nodes.find((node) => node.name === "options")?.objectMembers,
        undefined,
      );
    } finally {
      if (previous === undefined) delete process.env.TTSC_GRAPH_BINARY;
      else process.env.TTSC_GRAPH_BINARY = previous;
    }
  };
