import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";

import { GraphFixtures } from "../internal/GraphFixtures";

export const test_static_graph_indexes_declarations_and_dependencies = async () => {
  const root = GraphFixtures.createOrderFixture();
  const dump = await buildGraphDump({ cwd: root, mode: "static" });

  TestValidator.equals("static indexer mode", dump.indexer, "static");
  TestValidator.equals("fixture languages", new Set(dump.languages), new Set(["typescript", "go"]));
  TestValidator.predicate("OrderService declaration is indexed", dump.nodes.some((node) => node.name === "OrderService"));
  TestValidator.predicate("Go declaration is indexed", dump.nodes.some((node) => node.name === "LoadOrder"));
  TestValidator.predicate(
    "Go package declaration is indexed",
    dump.nodes.some((node) => node.language === "go" && node.kind === "package" && node.name === "main"),
  );
  TestValidator.predicate(
    "class method produces dependency evidence",
    dump.edges.some((edge) => (edge.kind === "calls" || edge.kind === "type_ref") && edge.from.includes("OrderService.create")),
  );
  TestValidator.predicate(
    "side-effect imports produce import edges",
    dump.edges.some((edge) => edge.kind === "imports" && edge.to.endsWith(":./setup")),
  );
  TestValidator.predicate(
    "go import blocks produce import edges",
    ["fmt", "strings"].every((name) =>
      dump.edges.some((edge) => edge.kind === "imports" && edge.to.endsWith(`:${name}`)),
    ),
  );
};
