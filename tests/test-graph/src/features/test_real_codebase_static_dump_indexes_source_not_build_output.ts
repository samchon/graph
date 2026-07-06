import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";

import { GraphPaths } from "../internal/GraphPaths";

export const test_real_codebase_static_dump_indexes_source_not_build_output = async () => {
  const dump = await buildGraphDump({
    cwd: GraphPaths.graphPackageRoot,
    mode: "static",
    languages: ["typescript"],
  });

  TestValidator.equals("real codebase static indexer", dump.indexer, "static");
  TestValidator.equals("real codebase language set", dump.languages, ["typescript"]);
  TestValidator.predicate("real codebase indexes substantial source graph", dump.nodes.length > 100 && dump.edges.length > 100);
  TestValidator.predicate("real codebase does not index built lib output", dump.nodes.every((node) => !node.file.startsWith("lib/")));
  for (const expected of [
    ["src/SamchonGraphApplication.ts", "SamchonGraphApplication"],
    ["src/indexer/buildGraphDump.ts", "buildGraphDump"],
    ["src/indexer/buildLspGraph.ts", "buildLspGraph"],
    ["src/model/GraphMemory.ts", "GraphMemory"],
    ["src/operations/runTrace.ts", "runTrace"],
  ]) {
    TestValidator.predicate(
      `real codebase indexes ${expected[1]}`,
      dump.nodes.some((node) => node.file === expected[0] && node.name === expected[1]),
    );
  }
};
