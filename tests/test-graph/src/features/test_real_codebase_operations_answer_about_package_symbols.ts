import { TestValidator } from "@nestia/e2e";
import { SamchonGraphMemory, SamchonGraphApplication, buildGraphDump } from "@samchon/graph";

import { GraphPaths } from "../internal/GraphPaths";

export const test_real_codebase_operations_answer_about_package_symbols = async () => {
  const graph = SamchonGraphMemory.from(
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
      question: "Inspect SamchonGraphMemory",
      draft: { reason: "Selected symbol shape needs details.", type: "details" },
      review: "Details is the right request.",
      request: { type: "details", handles: ["SamchonGraphMemory"], neighbors: true },
    })
  ).result;
  TestValidator.predicate(
    "real codebase details lists SamchonGraphMemory members",
    details.nodes.some(
      (node) =>
        node.name === "SamchonGraphMemory" &&
        node.members?.some((member) => member.name === "SamchonGraphMemory.node"),
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
        maxNodes: 64,
      },
    })
  ).result;
  TestValidator.predicate(
    "real codebase trace reaches a graph builder or dump trust boundary",
    trace.reached.some((node) =>
      [
        "buildGraphResult",
        "buildLspGraph",
        "buildStaticGraph",
        "parseGraphDump",
        "validateSemanticGraphNode",
      ].includes(node.name),
    ),
  );
};
