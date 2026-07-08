import { TestValidator } from "@nestia/e2e";

import { ContractGraph } from "../internal/ContractGraph";

export const test_operations_preserve_contract_evidence_and_navigation = async () => {
  const app = ContractGraph.createApplication();

  const overview = (await ContractGraph.call(app, { type: "overview", aspect: "all" })).result;
  TestValidator.predicate("overview exposes file count", overview.counts.files >= 1);
  TestValidator.predicate("overview includes diagnostics", overview.diagnostics.some((diagnostic) => diagnostic.code === "C001"));
  // publicApi ranks true top-level API kinds (class/interface/function/type/enum),
  // so the Service class surfaces rather than its individual methods.
  TestValidator.predicate("overview ranks public API", overview.publicApi.some((node) => node.name === "Root.Service"));

  const lookup = (await ContractGraph.call(app, { type: "lookup", query: "ExternalApi", includeExternal: true })).result;
  TestValidator.predicate("lookup can include external symbols", lookup.hits.some((hit) => hit.name === "ExternalApi"));

  const hiddenExternal = (await ContractGraph.call(app, { type: "lookup", query: "ExternalApi" })).result;
  TestValidator.predicate("lookup hides external symbols by default", hiddenExternal.hits.every((hit) => hit.name !== "ExternalApi"));

  const details = (
    await ContractGraph.call(app, {
      type: "details",
      handles: ["Root.Service.run", "Root.Service", "missing"],
      neighbors: true,
      includeExternal: true,
    })
  ).result;
  TestValidator.predicate("details reports unknown handles", details.unknown.includes("missing"));
  TestValidator.predicate(
    "details returns calls",
    details.nodes.some((node) => node.calls?.some((ref) => ref.name === "helper" && ref.relation === "calls")),
  );
  TestValidator.predicate(
    "details returns type edges",
    details.nodes.some((node) => node.types?.some((ref) => ref.name === "Input" && ref.relation === "type_ref")),
  );
  TestValidator.predicate(
    "details returns members",
    details.nodes.some((node) => node.members?.some((member) => member.name === "Root.Service.run")),
  );
  TestValidator.predicate(
    "details carries diagnostics",
    details.nodes.some((node) => node.diagnostics?.some((diagnostic) => diagnostic.code === "C001")),
  );

  const forward = (
    await ContractGraph.call(app, {
      type: "trace",
      from: "Root.Service.run",
      direction: "forward",
      focus: "execution",
    })
  ).result;
  TestValidator.predicate("forward trace reaches helper", forward.reached.some((node) => node.name === "helper"));
  TestValidator.predicate("forward trace includes evidence spans", forward.hops.some((hop) => hop.evidence?.file === "src/contract.ts"));

  const reverse = (
    await ContractGraph.call(app, {
      type: "trace",
      from: "Root.Service.run",
      direction: "reverse",
      focus: "all",
    })
  ).result;
  TestValidator.predicate(
    "reverse trace reaches test/reference callers",
    reverse.reached.some((node) => node.name === "testRun") && reverse.reached.some((node) => node.name === "helper"),
  );

  const path = (await ContractGraph.call(app, { type: "trace", from: "Root.Service.run", to: "helper" })).result;
  TestValidator.predicate("path trace returns ordered path", path.path?.some((node) => node.name === "helper") === true);

  const ambiguous = (await ContractGraph.call(app, { type: "trace", from: "run" })).result;
  TestValidator.predicate("ambiguous trace returns candidates", ambiguous.candidates?.length >= 2);

  const ambiguousTarget = (
    await ContractGraph.call(app, { type: "trace", from: "Root.Service.run", to: "run" })
  ).result;
  TestValidator.predicate(
    "ambiguous target asks to clarify with candidates",
    ambiguousTarget.next.action === "clarify" && (ambiguousTarget.candidates?.length ?? 0) >= 2,
  );

  const entrypoints = (
    await ContractGraph.call(app, {
      type: "entrypoints",
      query: "Root.Service.run helper",
      limit: 4,
    })
  ).result;
  TestValidator.predicate("entrypoints returns ranked handles", entrypoints.ranked.some((node) => node.name === "Root.Service.run"));

  const tour = (
    await ContractGraph.call(app, {
      type: "tour",
      question: "Root.Service.run helper",
      limit: 4,
    })
  ).result;
  TestValidator.predicate("tour returns anchors", tour.answerAnchors.length > 0 && tour.nearbyPaths.length > 0);
};
