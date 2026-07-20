import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";

import { GraphFixtures } from "../internal/GraphFixtures";
import { GraphPaths } from "../internal/GraphPaths";

export const test_python_lsp_drops_local_values_but_keeps_callable_closures = async () => {
  const dump = await buildGraphDump({
    cwd: GraphFixtures.createPythonLocalFixture(),
    mode: "lsp",
    languages: ["python"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer, "--python-locals"],
  });

  const names = dump.nodes.map((node) => node.qualifiedName ?? node.name);
  TestValidator.predicate(
    "Python parameters and ordinary local values do not become graph nodes",
    !names.includes("App.dispatch.self") &&
      !names.includes("App.dispatch.ctx") &&
      !names.includes("App.dispatch.response"),
  );
  TestValidator.predicate(
    "module values, class values, and executable local bindings stay indexed",
    names.includes("module_value") &&
      names.includes("App.class_value") &&
      names.includes("App.dispatch.handler"),
  );
  TestValidator.equals(
    "a directly bound lambda is marked as a closure",
    dump.nodes.find((node) => node.qualifiedName === "App.dispatch.handler")
      ?.closure,
    true,
  );

  const targetEdges = dump.edges.filter((edge) =>
    edge.to.endsWith("#target:function"),
  );
  const owners = targetEdges.map((edge) => edge.from);
  TestValidator.predicate(
    "an assigned call belongs directly to its enclosing method",
    owners.some((owner) => owner.endsWith("#App.dispatch:method")) &&
      !owners.some((owner) => owner.includes("App.dispatch.response")),
  );
  TestValidator.equals(
    "a local lambda owns its body without duplicating the call on its parent",
    owners.filter((owner) => owner.endsWith("#App.dispatch:method")).length,
    1,
  );
  TestValidator.predicate(
    "the callable local remains a real call owner",
    targetEdges.some(
      (edge) =>
        edge.from.endsWith("#App.dispatch.handler:variable") &&
        edge.kind === "calls",
    ),
  );
};
