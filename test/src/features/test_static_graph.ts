const { TestValidator } = require("@nestia/e2e");
const { GraphMemory, SamchonGraphApplication, buildGraphDump } =
  require("../../../lib");
const { createOrderFixture } = require("../internal/fixtures.ts");

exports.test_static_graph_indexes_declarations_and_dependencies = async () => {
  const root = createOrderFixture();
  const dump = await buildGraphDump({ cwd: root, mode: "static" });

  TestValidator.equals("static indexer mode", dump.indexer, "static");
  TestValidator.equals(
    "fixture languages",
    new Set(dump.languages),
    new Set(["typescript", "go"]),
  );
  TestValidator.predicate(
    "OrderService declaration is indexed",
    dump.nodes.some((node) => node.name === "OrderService"),
  );
  TestValidator.predicate(
    "Go declaration is indexed",
    dump.nodes.some((node) => node.name === "LoadOrder"),
  );
  TestValidator.predicate(
    "class method produces dependency evidence",
    dump.edges.some(
      (edge) =>
        (edge.kind === "calls" || edge.kind === "type_ref") &&
        edge.from.includes("OrderService.create"),
    ),
  );
  TestValidator.predicate(
    "side-effect imports produce import edges",
    dump.edges.some((edge) => edge.kind === "imports" && edge.to.endsWith(":./setup")),
  );
};

exports.test_application_lookup_details_and_tour_use_resident_graph = async () => {
  const root = createOrderFixture();
  const graph = GraphMemory.from(await buildGraphDump({ cwd: root, mode: "static" }));
  const app = new SamchonGraphApplication(graph);

  const lookup = await app.inspect_code_graph({
    question: "Find OrderService",
    draft: { reason: "Named symbol lookup is smallest.", type: "lookup" },
    review: "Lookup is appropriate.",
    request: { type: "lookup", query: "OrderService" },
  });
  TestValidator.equals("lookup result type", lookup.result.type, "lookup");
  TestValidator.predicate(
    "lookup finds OrderService",
    lookup.result.hits.some((hit) => hit.name === "OrderService"),
  );

  const details = await app.inspect_code_graph({
    question: "Show OrderService shape",
    draft: { reason: "Selected symbol shape needs details.", type: "details" },
    review: "Details is appropriate.",
    request: { type: "details", handles: ["OrderService"], neighbors: true },
  });
  TestValidator.equals("details result type", details.result.type, "details");
  TestValidator.equals("details resolves OrderService", details.result.nodes[0].name, "OrderService");

  const tour = await app.inspect_code_graph({
    question: "How does order creation work?",
    draft: { reason: "Broad flow needs a tour.", type: "tour" },
    review: "Tour is appropriate.",
    request: { type: "tour", question: "order creation" },
  });
  TestValidator.equals("tour result type", tour.result.type, "tour");
  TestValidator.predicate("tour has entrypoints", tour.result.entrypoints.length > 0);
};
