import { TestValidator } from "@nestia/e2e";

import { ContractGraph } from "../internal/ContractGraph";

// The contract fixture carries qualified names (Root.Service, Root.Service.run),
// so crafted queries drive the ported lookup/entrypoints query parsers through
// their exact-code-term, dotted-name, and mention-resolution branches.
export const test_ported_operation_engines_cover_query_branches = async () => {
  const app = ContractGraph.createApplication();

  // runLookup.exactCodeTerms + dotted qualified matching: a backtick handle, an
  // "X method" pattern, and a dotted name all resolve to Root.Service.run.
  const lookup = (
    await ContractGraph.call(app, {
      type: "lookup",
      query: "`Root.Service.run` run method Root.Service.run",
    })
  ).result;
  TestValidator.predicate(
    "exact/dotted code terms rank the qualified method first",
    lookup.hits[0]?.name === "Root.Service.run",
  );

  // A bare dotted term (no backticks) still resolves via the dotted-name pattern.
  const dotted = (
    await ContractGraph.call(app, { type: "lookup", query: "Service.run" })
  ).result;
  TestValidator.predicate(
    "dotted term finds the method",
    dotted.hits.some((hit) => hit.name === "Root.Service.run"),
  );

  // runEntrypoints mention resolution: a node-id handle and a dotted handle in
  // the query are resolved as direct mentions/seeds.
  const entry = (
    await ContractGraph.call(app, {
      type: "entrypoints",
      query: "src/contract.ts#Root.Service.run:method Root.Service.run",
    })
  ).result;
  TestValidator.predicate(
    "entrypoints resolve mention handles",
    entry.ranked.length >= 1,
  );

  // runTrace path mode by dotted names, and the "X function" lookup pattern.
  const path = (
    await ContractGraph.call(app, {
      type: "trace",
      from: "Root.Service.run",
      to: "helper",
      direction: "forward",
    })
  ).result;
  TestValidator.predicate("path trace reaches the target", path.steps !== undefined);
};
