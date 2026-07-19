import { TestValidator } from "@nestia/e2e";
import {
  SamchonGraphApplication,
  SamchonGraphMemory,
  buildGraph,
  type ISamchonGraphDetails,
  type ISamchonGraphDump,
} from "@samchon/graph";
import fs from "node:fs";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";

export const test_build_graph_preserves_its_consumed_source_snapshot =
  async () => {
    const root = GraphPaths.createTempDirectory("samchon-graph-snapshot-source-");
    const file = path.join(root, "target.ts");
    fs.writeFileSync(
      file,
      [
        "/** The original snapshot documentation. */",
        "export function target(value: string): string {",
        "  return value;",
        "}",
      ].join("\n"),
    );

    const graph = await buildGraph({
      cwd: root,
      mode: "static",
      languages: ["typescript"],
    });
    const target = graph.nodes.find(
      (node) => node.kind === "function" && node.name === "target",
    );
    TestValidator.predicate("the consumed declaration was indexed", target !== undefined);

    fs.writeFileSync(
      file,
      [
        "/** Later disk documentation that is not part of the graph. */",
        "export function target(value: number): number {",
        "  return value;",
        "}",
      ].join("\n"),
    );

    const details = await inspect(graph, target!.id);
    const selected = details.nodes[0];
    TestValidator.predicate(
      "buildGraph keeps the exact signature bytes consumed by its index pass",
      selected?.signature?.includes("value: string") === true &&
        selected.signature.includes("value: number") === false,
    );
    TestValidator.predicate(
      "buildGraph keeps the exact documentation bytes consumed by its index pass",
      selected?.doc?.includes("original snapshot") === true &&
        selected.doc.includes("Later disk") === false,
    );

    const detachedDump: ISamchonGraphDump = {
      project: root,
      languages: ["typescript"],
      indexer: "static",
      nodes: [
        {
          id: "target.ts#target:function",
          kind: "function",
          language: "typescript",
          name: "target",
          file: "target.ts",
          external: false,
          evidence: { startLine: 2, endLine: 4 },
        },
      ],
      edges: [],
    };
    const detached = await inspect(
      SamchonGraphMemory.from(detachedDump),
      "target.ts#target:function",
    );
    TestValidator.equals(
      "a provenance-free dump does not read a later mutable disk signature",
      detached.nodes[0]?.signature,
      undefined,
    );
    TestValidator.equals(
      "a provenance-free dump does not read later mutable disk documentation",
      detached.nodes[0]?.doc,
      undefined,
    );
  };

async function inspect(
  graph: SamchonGraphMemory,
  handle: string,
): Promise<ISamchonGraphDetails> {
  const response = await new SamchonGraphApplication(graph).inspect_code_graph({
    question: "Inspect the selected snapshot declaration.",
    draft: { reason: "The exact declaration shape is required.", type: "details" },
    review: "Details is the narrowest operation.",
    request: { type: "details", handles: [handle] },
  });
  return response.result as ISamchonGraphDetails;
}
