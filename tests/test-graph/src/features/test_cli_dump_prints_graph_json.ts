import { TestValidator } from "@nestia/e2e";
import { execFileSync } from "node:child_process";

import { GraphFixtures } from "../internal/GraphFixtures";
import { GraphPaths } from "../internal/GraphPaths";

export const test_cli_dump_prints_graph_json = () => {
  const root = GraphFixtures.createOrderFixture();
  const output = execFileSync(process.execPath, [
    GraphPaths.graphBin,
    "dump",
    "--mode",
    "static",
    "--cwd",
    root,
  ], { encoding: "utf8" });
  const dump = JSON.parse(output);
  TestValidator.equals("CLI dump indexer", dump.indexer, "static");
  TestValidator.predicate("CLI dump has nodes", dump.nodes.length > 0);
};
