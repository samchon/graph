import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";

import { GraphFixtures } from "../internal/GraphFixtures";
import { GraphPaths } from "../internal/GraphPaths";

export const test_lsp_mode_dual_attributes_non_method_member_calls = async () => {
  const root = GraphFixtures.createDualOwnerFixture();
  const dump = await buildGraphDump({
    cwd: root,
    mode: "lsp",
    languages: ["typescript"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer, "--dual-owner"],
  });

  const toTarget = dump.edges.filter((edge) => edge.to.includes("#target:"));
  const owners = toTarget.map((edge) => edge.from).sort();

  // ttsc's fact-builder walks a non-method member's (a property, including an
  // arrow-function-valued field) body attributed to both the member itself
  // and its enclosing class; a method is attributed solely to itself.
  TestValidator.predicate(
    "a call inside an arrow-function field attributes to both the field and the class",
    owners.some((from) => from.includes("Owner.helper")) &&
      owners.filter((from) => from.endsWith("#Owner:class")).length === 1,
  );
  TestValidator.predicate(
    "a call inside a method attributes only to the method, not the class",
    owners.some((from) => from.includes("Owner.method")),
  );
  TestValidator.equals(
    "exactly three edges point at target: helper, its class, and method",
    owners.length,
    3,
  );
  TestValidator.predicate(
    "method's call is still classified correctly even split across two lines",
    toTarget.every((edge) => edge.kind === "calls"),
  );
};
