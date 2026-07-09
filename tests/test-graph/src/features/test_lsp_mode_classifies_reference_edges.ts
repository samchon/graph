import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";

import { GraphFixtures } from "../internal/GraphFixtures";
import { GraphPaths } from "../internal/GraphPaths";

export const test_lsp_mode_classifies_reference_edges = async () => {
  const root = GraphFixtures.createClassifyFixture();
  const dump = await buildGraphDump({
    cwd: root,
    mode: "lsp",
    languages: ["typescript"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer, "--classify"],
  });

  const kinds = new Set(dump.edges.map((edge) => edge.kind));
  const has = (kind: string) => kinds.has(kind);

  TestValidator.predicate(
    "LSP struct symbol kind maps to graph type",
    dump.nodes.some((node) => node.qualifiedName === "Owner.alias" && node.kind === "type"),
  );

  // An identifier followed by `(` invokes: a class/constructor target becomes an
  // instantiation, everything else a call.
  TestValidator.predicate("invoked non-class reference is a call", has("calls"));
  TestValidator.predicate("invoked constructor reference is an instantiation", has("instantiates"));
  // Bare references resolve by the target's kind.
  TestValidator.predicate("bare reference to a type is a type reference", has("type_ref"));
  TestValidator.predicate("bare reference to a value is an access", has("accesses"));
  TestValidator.predicate("bare reference to a callable stays a generic reference", has("references"));

  TestValidator.predicate(
    "every classified edge points at an Owner member",
    dump.edges.every((edge) => edge.from.includes("Owner") && edge.to.includes("Owner.")),
  );
};
