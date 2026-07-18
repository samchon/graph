import fs from "node:fs";
import path from "node:path";

import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";

import { GraphPaths } from "../internal/GraphPaths";

/**
 * Zig has no import statement: a module arrives as an ordinary
 * `const std = @import("std");`, which no keyword-led import rule can see. The
 * static lane reads Zig's own `@import` form so the module still surfaces as an
 * external dependency the file imports, exactly like a keyword import elsewhere.
 */
export const test_zig_static_imports_become_external_modules = async () => {
  const root = GraphPaths.createTempDirectory("samchon-zig-import-");
  fs.writeFileSync(
    path.join(root, "app.zig"),
    [
      'const std = @import("std");',
      "pub fn main() void {",
      "    _ = std;",
      "}",
    ].join("\n"),
  );
  const dump = await buildGraphDump({
    cwd: root,
    mode: "static",
    languages: ["zig"],
  });

  const std = dump.nodes.find(
    (node) => node.name === "std" && node.external === true,
  );
  TestValidator.predicate(
    "a zig @import surfaces the module as an external symbol",
    std !== undefined,
  );
  TestValidator.predicate(
    "the file carries an imports edge to the @imported module",
    dump.edges.some((edge) => edge.kind === "imports" && edge.to === std?.id),
  );
};
