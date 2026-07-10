import { TestValidator } from "@nestia/e2e";
import { buildGraph } from "@samchon/graph";

import { GraphFixtures } from "../internal/GraphFixtures";

export const test_build_graph_returns_a_queryable_memory = async () => {
  const root = GraphFixtures.createOrderFixture();
  const graph = await buildGraph({ cwd: root, mode: "static" });
  TestValidator.predicate(
    "buildGraph resolves a queryable SamchonGraphMemory",
    graph.nodes.some((node) => node.name === "OrderService"),
  );
};
