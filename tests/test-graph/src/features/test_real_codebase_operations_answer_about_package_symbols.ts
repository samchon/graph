import { TestValidator } from "@nestia/e2e";
import { GraphMemory, SamchonGraphApplication, buildGraphDump } from "@samchon/graph";

import { GraphPaths } from "../internal/GraphPaths";

export const test_real_codebase_operations_answer_about_package_symbols = async () => {
  const graph = GraphMemory.from(
    await buildGraphDump({
      cwd: GraphPaths.graphPackageRoot,
      mode: "static",
      languages: ["typescript"],
    }),
  );
  const app = new SamchonGraphApplication(graph);

  const lookup = (
    await app.inspect_code_graph({
      question: "Find SamchonGraphApplication",
      draft: { reason: "Named symbol lookup is smallest.", type: "lookup" },
      review: "Lookup is the right request.",
      request: { type: "lookup", query: "SamchonGraphApplication" },
    })
  ).result;
  TestValidator.predicate(
    "real codebase lookup finds SamchonGraphApplication",
    lookup.hits.some(
      (hit) =>
        hit.name === "SamchonGraphApplication" &&
        hit.file === "src/SamchonGraphApplication.ts",
    ),
  );

  const details = (
    await app.inspect_code_graph({
      question: "Inspect GraphMemory",
      draft: { reason: "Selected symbol shape needs details.", type: "details" },
      review: "Details is the right request.",
      request: { type: "details", handles: ["GraphMemory"], neighbors: true },
    })
  ).result;
  TestValidator.predicate(
    "real codebase details lists GraphMemory members",
    details.nodes.some(
      (node) =>
        node.name === "GraphMemory" &&
        node.members?.some((member) => member.name === "GraphMemory.node"),
    ),
  );

  const trace = (
    await app.inspect_code_graph({
      question: "Trace buildGraphDump",
      draft: { reason: "Flow question needs trace.", type: "trace" },
      review: "Trace is the right request.",
      request: {
        type: "trace",
        from: "buildGraphDump",
        direction: "forward",
        focus: "all",
        maxDepth: 2,
        maxNodes: 12,
      },
    })
  ).result;
  TestValidator.predicate(
    "real codebase trace reaches graph builders or validators",
    trace.reached.some((node) =>
      ["buildLspGraph", "buildStaticGraph", "validateDump"].includes(node.name),
    ),
  );
};
