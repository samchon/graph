import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";
import fs from "node:fs";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";

/**
 * The legacy flat `SymbolInformation` shape drops each member's owner *kind*,
 * so `csharpOwnerKindsOf` rebuilds it from the container symbols. csharp-ls's
 * ordinary output always names a member's owner by a full path that is exactly
 * registered, so the recovery only ever takes its exact-match arm. This drives
 * the fallback arms it otherwise never reaches:
 *
 *  - `Widget` reports an *undefined* `containerName`, so it registers under the
 *    bare name `Widget`; its `Field1` member names the owner `Root.Widget`,
 *    whose full path is not registered — the owner class is recovered only by
 *    the unique simple-name `Widget`, and the variable is promoted to a field.
 *  - Two `Sink` classes share that simple name across `Alpha` and `Beta`, so a
 *    member that names `Gamma.Sink` is ambiguous: the simple name resolves to
 *    two containers, the fallback yields nothing, and the member stays a bare
 *    variable rather than being promoted.
 *  - A member whose owner (`Ghost.Unknown`) matches no container at all, by
 *    full path or simple name, likewise stays an unpromoted variable.
 */
export const test_csharp_flat_symbol_owner_fallback = async () => {
  const root = GraphPaths.createTempDirectory(
    "samchon-graph-csharp-owner-fallback-",
  );
  fs.writeFileSync(
    path.join(root, "Fallback.cs"),
    [
      "namespace Root", // 0
      "{", // 1
      "    public class Widget", // 2
      "    {", // 3
      "        public int Field1;", // 4
      "    }", // 5
      "}", // 6
      "namespace Alpha { public class Sink { } }", // 7
      "namespace Beta { public class Sink { } }", // 8
      "    public int Orphan;", // 9
      "    public int Ambiguous;", // 10
      "",
    ].join("\n"),
  );

  const dump = await buildGraphDump({
    cwd: root,
    mode: "lsp",
    languages: ["csharp"],
    server: process.execPath,
    serverArgs: [
      GraphPaths.fakeLspServer,
      "--csharp-symbols",
      "--symbol-information",
      "--csharp-owner-fallback",
    ],
    lspReferenceLimit: 0,
  });
  TestValidator.equals(
    "the flat owner-fallback data stays in the LSP lane",
    dump.indexer,
    "lsp",
  );

  const kindOf = (name: string): string | undefined =>
    dump.nodes.find((node) => node.name === name)?.kind;

  TestValidator.equals(
    "a member whose owner is recovered by unique simple-name fallback is promoted to a field",
    kindOf("Field1"),
    "field",
  );
  TestValidator.equals(
    "a member whose owner simple name is ambiguous across namespaces stays an unpromoted variable",
    kindOf("Ambiguous"),
    "variable",
  );
  TestValidator.equals(
    "a member whose owner matches no container by full path or simple name stays an unpromoted variable",
    kindOf("Orphan"),
    "variable",
  );
};
