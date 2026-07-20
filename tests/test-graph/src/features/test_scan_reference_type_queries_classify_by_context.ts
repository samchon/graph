import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";
import fs from "node:fs";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";

/**
 * A `typeof X` reference is a type query, not a value access — but only when the
 * surrounding syntax puts it in type space. The reference classifier reads the
 * source before the reference to decide: a TypeScript type-alias right-hand side
 * (`type Alias = typeof X`) and an `as` type assertion (`x as typeof X`) are
 * type queries, and in any non-TypeScript language a `typeof X` is always a type
 * reference. This drives those three classifier arms with scripted references.
 */
export const test_scan_reference_type_queries_classify_by_context = async () => {
  const root = GraphPaths.createTempDirectory("samchon-graph-type-queries-");
  fs.writeFileSync(
    path.join(root, "queries.ts"),
    [
      "export class Target {}",
      "type Alias = typeof Target;",
      "const b = null as typeof Target;",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(root, "queries.go"),
    ["package main", "type Target struct{}", "var x = typeof Target", ""].join(
      "\n",
    ),
  );

  const dump = await buildGraphDump({
    cwd: root,
    mode: "lsp",
    languages: ["typescript", "go"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer, "--type-queries"],
  });
  TestValidator.equals("the type-query references stay in the LSP lane", dump.indexer, "lsp");

  // The TypeScript type-alias and `as`-assertion references both resolve to a
  // type reference, not a runtime access.
  TestValidator.predicate(
    "a TypeScript typeof in type-alias / assertion context is a type reference",
    dump.edges.some(
      (edge) =>
        edge.to.includes("queries.ts") &&
        edge.to.includes("Target") &&
        edge.kind === "type_ref",
    ),
  );

  // A non-TypeScript typeof is unconditionally a type reference.
  TestValidator.predicate(
    "a non-TypeScript typeof is a type reference",
    dump.edges.some((edge) => {
      if (edge.kind !== "type_ref") return false;
      // A non-TypeScript target carries a provider-native semantic id whose
      // file lives on the node, not in the opaque id string, so resolve it.
      const target = dump.nodes.find((node) => node.id === edge.to);
      return (
        target !== undefined &&
        target.name === "Target" &&
        target.file.includes("queries.go")
      );
    }),
  );
};
