import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";
import fs from "node:fs";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";

/**
 * A flat `SymbolInformation` server can place a member's range start on a line
 * that no longer exists in the source it just parsed — a stale index, a
 * generated symbol, a header that opens above the file. The flat converter must
 * survive the missing declaration line rather than read past the end of the
 * source array:
 *
 *  - The declaration line falls back to the empty string, so a C# class member
 *    that would otherwise be sharpened into a field or property finds nothing
 *    to parse and stays a plain `property`.
 *  - A Java member's modifier scan reads that same empty line and reports no
 *    visibility, instead of indexing whatever text happened to sit at the
 *    out-of-range offset.
 */
export const test_scan_flat_symbols_past_the_source_recover_defaults = async () => {
  const root = GraphPaths.createTempDirectory("samchon-graph-flat-overflow-");
  fs.writeFileSync(
    path.join(root, "Sample.cs"),
    [
      "namespace Demo",
      "{",
      "    public class Bag",
      "    {",
      "        public int Score { get; set; }",
      "    }",
      "}",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(root, "Sample.java"),
    ["package sample;", "public class Api {", "}", ""].join("\n"),
  );

  const dump = await buildGraphDump({
    cwd: root,
    mode: "lsp",
    languages: ["csharp", "java"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer, "--overflow-symbols"],
    lspReferenceLimit: 0,
  });
  TestValidator.equals(
    "the out-of-range flat symbols stay in the LSP lane",
    dump.indexer,
    "lsp",
  );

  const named = (name: string) => dump.nodes.find((node) => node.name === name);

  // A class-owned variable whose declaration line resolves to "" has no C#
  // field/property text to recover, so it stays a property.
  TestValidator.equals(
    "a C# class member past the source recovers the default property kind",
    named("loose")?.kind,
    "property",
  );

  // A class-owned variable whose declaration line is a real C# property is
  // sharpened back to a property through the field/property recovery.
  TestValidator.equals(
    "a C# class variable is sharpened to a property from its declaration line",
    named("Score")?.kind,
    "property",
  );

  // The Java modifier scan reads the same empty line and reports no visibility.
  TestValidator.equals(
    "a Java member past the source declares no visibility modifier",
    [named("gone()")?.kind, named("gone()")?.modifiers],
    ["method", undefined],
  );
};
