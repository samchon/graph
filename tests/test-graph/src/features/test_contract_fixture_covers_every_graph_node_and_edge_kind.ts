import { TestValidator } from "@nestia/e2e";
import { GraphMemory } from "@samchon/graph";

import { GraphFixtures } from "../internal/GraphFixtures";

export const test_contract_fixture_covers_every_graph_node_and_edge_kind = () => {
  const { dump } = GraphFixtures.createContractFixture();
  const graph = GraphMemory.from(dump);

  TestValidator.equals(
    "all graph node kinds are represented",
    [...new Set(graph.nodes.map((node) => node.kind))].sort(),
    [...GraphFixtures.GRAPH_NODE_KINDS].sort(),
  );
  TestValidator.equals(
    "all graph edge kinds are represented",
    [...new Set(graph.edges.map((edge) => edge.kind))].sort(),
    [...GraphFixtures.GRAPH_EDGE_KINDS].sort(),
  );
};
