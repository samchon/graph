import { TestValidator } from "@nestia/e2e";
import { SamchonGraphMemory, SamchonGraphApplication, buildGraphDump } from "@samchon/graph";

import { GraphFixtures } from "../internal/GraphFixtures";

export const test_application_lookup_details_and_tour_use_resident_graph = async () => {
  const root = GraphFixtures.createOrderFixture();
  const graph = SamchonGraphMemory.from(await buildGraphDump({ cwd: root, mode: "static" }));
  const app = new SamchonGraphApplication(graph);

  const lookup = await app.inspect_code_graph({
    question: "Find OrderService",
    draft: { reason: "Named symbol lookup is smallest.", type: "lookup" },
    review: "Lookup is appropriate.",
    request: { type: "lookup", query: "OrderService" },
  });
  TestValidator.equals("lookup result type", lookup.result.type, "lookup");
  TestValidator.predicate("lookup finds OrderService", lookup.result.hits.some((hit) => hit.name === "OrderService"));

  const details = await app.inspect_code_graph({
    question: "Show OrderService shape",
    draft: { reason: "Selected symbol shape needs details.", type: "details" },
    review: "Details is appropriate.",
    request: { type: "details", handles: ["OrderService"], neighbors: true },
  });
  TestValidator.equals("details result type", details.result.type, "details");
  TestValidator.equals("details resolves OrderService", details.result.nodes[0]?.name, "OrderService");

  const tour = await app.inspect_code_graph({
    question: "How does order creation work?",
    draft: { reason: "Broad flow needs a tour.", type: "tour" },
    review: "Tour is appropriate.",
    request: { type: "tour", query: "order creation" },
  });
  TestValidator.equals("tour result type", tour.result.type, "tour");
  TestValidator.predicate("tour has entrypoints", tour.result.entrypoints.length > 0);
};
