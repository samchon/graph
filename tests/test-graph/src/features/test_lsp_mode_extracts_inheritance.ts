import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";

import { GraphFixtures } from "../internal/GraphFixtures";
import { GraphPaths } from "../internal/GraphPaths";

export const test_lsp_mode_extracts_inheritance = async () => {
  const root = GraphFixtures.createLspInheritanceFixture();
  const dump = await buildGraphDump({
    cwd: root,
    mode: "lsp",
    languages: ["typescript"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer, "--inheritance"],
  });

  const has = (kind: string, from: string, to: string) =>
    dump.edges.some(
      (edge) => edge.kind === kind && edge.from.includes(from) && edge.to.includes(to),
    );

  // Supertypes are parsed from the declaration line and resolved to reported symbols.
  TestValidator.predicate("extends resolved", has("extends", "Child:class", "Parent:class"));
  TestValidator.predicate("implements resolved", has("implements", "Child:class", "Iface:interface"));
  // A decorator above the class links to the decorator symbol.
  TestValidator.predicate("decorator becomes a decorates edge", has("decorates", "Child:class", "Deco:function"));

  // An unresolved supertype produces no edge.
  TestValidator.predicate(
    "unresolved supertype dropped",
    dump.edges.every((edge) => !edge.to.includes("Missing")),
  );
  // A repeated supertype collapses to one edge.
  TestValidator.equals(
    "duplicate supertype deduped",
    dump.edges.filter((edge) => edge.kind === "extends" && edge.from.includes("Dup:class")).length,
    1,
  );
};
