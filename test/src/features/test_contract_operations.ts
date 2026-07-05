const { TestValidator } = require("@nestia/e2e");
const { GraphMemory, SamchonGraphApplication } = require("../../../lib");
const {
  GRAPH_EDGE_KINDS,
  GRAPH_NODE_KINDS,
  GRAPH_REQUEST_TYPES,
  createContractFixture,
} = require("../internal/fixtures.ts");

const call = (app, request) =>
  app.inspect_code_graph({
    question: `contract ${request.type}`,
    draft: { reason: `${request.type} is under contract test.`, type: request.type },
    review: "Contract fixture intentionally exercises this request branch.",
    request,
  });

exports.test_contract_fixture_covers_every_graph_node_and_edge_kind = () => {
  const { dump } = createContractFixture();
  const graph = GraphMemory.from(dump);

  TestValidator.equals(
    "all graph node kinds are represented",
    [...new Set(graph.nodes.map((node) => node.kind))].sort(),
    [...GRAPH_NODE_KINDS].sort(),
  );
  TestValidator.equals(
    "all graph edge kinds are represented",
    [...new Set(graph.edges.map((edge) => edge.kind))].sort(),
    [...GRAPH_EDGE_KINDS].sort(),
  );
};

exports.test_application_exercises_every_request_branch = async () => {
  const { dump } = createContractFixture();
  const graph = GraphMemory.from(dump);
  const app = new SamchonGraphApplication(graph);
  const requests = [
    { type: "entrypoints", query: "Root.Service.run helper" },
    { type: "lookup", query: "Root.Service.run" },
    { type: "trace", from: "Root.Service.run", direction: "forward", focus: "execution" },
    { type: "details", handles: ["Root.Service.run"], neighbors: true },
    { type: "overview", aspect: "all" },
    { type: "tour", question: "Root.Service.run tour" },
    { type: "escape", reason: "outside graph", nextStep: "answer without graph" },
  ];

  const results = [];
  for (const request of requests) {
    const output = await call(app, request);
    results.push(output.result.type);
  }
  TestValidator.equals(
    "all request branches return matching result types",
    results,
    GRAPH_REQUEST_TYPES,
  );
};

exports.test_operations_preserve_contract_evidence_and_navigation = async () => {
  const { dump } = createContractFixture();
  const app = new SamchonGraphApplication(GraphMemory.from(dump));

  const overview = (await call(app, { type: "overview", aspect: "all" })).result;
  TestValidator.predicate("overview exposes file count", overview.counts.files >= 1);
  TestValidator.predicate(
    "overview includes diagnostics",
    overview.diagnostics.some((diagnostic) => diagnostic.code === "C001"),
  );
  TestValidator.predicate(
    "overview ranks public API",
    overview.publicApi.some((node) => node.name === "Root.Service.run"),
  );

  const lookup = (
    await call(app, {
      type: "lookup",
      query: "ExternalApi",
      includeExternal: true,
    })
  ).result;
  TestValidator.predicate(
    "lookup can include external symbols",
    lookup.hits.some((hit) => hit.name === "ExternalApi"),
  );

  const hiddenExternal = (
    await call(app, { type: "lookup", query: "ExternalApi" })
  ).result;
  TestValidator.predicate(
    "lookup hides external symbols by default",
    hiddenExternal.hits.every((hit) => hit.name !== "ExternalApi"),
  );

  const details = (
    await call(app, {
      type: "details",
      handles: ["Root.Service.run", "Root.Service", "missing"],
      neighbors: true,
      includeExternal: true,
    })
  ).result;
  TestValidator.predicate(
    "details reports unknown handles",
    details.unknown.includes("missing"),
  );
  TestValidator.predicate(
    "details returns calls",
    details.nodes.some((node) =>
      node.calls?.some((ref) => ref.name === "helper" && ref.relation === "calls"),
    ),
  );
  TestValidator.predicate(
    "details returns type edges",
    details.nodes.some((node) =>
      node.types?.some((ref) => ref.name === "Input" && ref.relation === "type_ref"),
    ),
  );
  TestValidator.predicate(
    "details returns members",
    details.nodes.some((node) =>
      node.members?.some((member) => member.name === "Root.Service.run"),
    ),
  );
  TestValidator.predicate(
    "details carries diagnostics",
    details.nodes.some((node) =>
      node.diagnostics?.some((diagnostic) => diagnostic.code === "C001"),
    ),
  );

  const forward = (
    await call(app, {
      type: "trace",
      from: "Root.Service.run",
      direction: "forward",
      focus: "execution",
    })
  ).result;
  TestValidator.predicate(
    "forward trace reaches helper",
    forward.reached.some((node) => node.name === "helper"),
  );
  TestValidator.predicate(
    "forward trace includes evidence spans",
    forward.hops.some((hop) => hop.evidence?.file === "src/contract.ts"),
  );

  const reverse = (
    await call(app, {
      type: "trace",
      from: "Root.Service.run",
      direction: "reverse",
      focus: "all",
    })
  ).result;
  TestValidator.predicate(
    "reverse trace reaches test/reference callers",
    reverse.reached.some((node) => node.name === "testRun") &&
      reverse.reached.some((node) => node.name === "helper"),
  );

  const path = (
    await call(app, {
      type: "trace",
      from: "Root.Service.run",
      to: "helper",
    })
  ).result;
  TestValidator.predicate(
    "path trace returns ordered path",
    path.path?.some((node) => node.name === "helper") === true,
  );

  const ambiguous = (
    await call(app, {
      type: "trace",
      from: "run",
    })
  ).result;
  TestValidator.predicate(
    "ambiguous trace returns candidates",
    ambiguous.candidates?.length >= 2,
  );

  const entrypoints = (
    await call(app, {
      type: "entrypoints",
      query: "Root.Service.run helper",
      limit: 4,
    })
  ).result;
  TestValidator.predicate(
    "entrypoints returns ranked handles",
    entrypoints.ranked.some((node) => node.name === "Root.Service.run"),
  );

  const tour = (
    await call(app, {
      type: "tour",
      question: "Root.Service.run helper",
      limit: 4,
    })
  ).result;
  TestValidator.predicate(
    "tour returns anchors",
    tour.answerAnchors.length > 0 && tour.nearbyPaths.length > 0,
  );
};
