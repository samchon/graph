import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";
import fs from "node:fs";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";

/**
 * A hierarchical server reports a declaration's range from its first modifier
 * and its selection from the identifier, so a declaration whose modifiers sit on
 * a line ABOVE the identifier spans two lines. Each per-language modifier reader
 * (C, C#, PHP, Java) must slice every line of that span — the whole first line
 * and the leading part of the identifier's line — to recover the visibility a
 * flat symbol never carries. This drives the multi-line slice, the
 * inverted-range guard, and the past-the-source fallback of all four readers.
 */
export const test_scan_declaration_slices_recover_multiline_modifiers = async () => {
  const root = GraphPaths.createTempDirectory("samchon-graph-decl-slices-");
  fs.writeFileSync(
    path.join(root, "Slices.c"),
    ["static", "int spanned(void) { return 0; }", ""].join("\n"),
  );
  fs.writeFileSync(
    path.join(root, "Slices.cs"),
    ["class Holder {", "public", "    static void Spanned() {}", "}", ""].join(
      "\n",
    ),
  );
  fs.writeFileSync(
    path.join(root, "Slices.php"),
    [
      "<?php",
      "class Holder {",
      "public",
      "    function spanned() {}",
      "}",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(root, "Slices.java"),
    ["class Holder {", "public", "    static void spanned() {}", "}", ""].join(
      "\n",
    ),
  );

  const dump = await buildGraphDump({
    cwd: root,
    mode: "lsp",
    languages: ["c", "csharp", "php", "java"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer, "--declaration-slices"],
    lspReferenceLimit: 0,
  });
  TestValidator.equals("the sliced declarations stay in the LSP lane", dump.indexer, "lsp");

  const modifiersOf = (language: string, name: string) =>
    dump.nodes.find((node) => node.language === language && node.name === name)
      ?.modifiers;

  // The modifiers span the line above the identifier; every reader recovers them
  // from the multi-line slice.
  TestValidator.equals(
    "a multi-line C declaration recovers its static linkage",
    modifiersOf("c", "spanned"),
    ["static"],
  );
  TestValidator.equals(
    "a multi-line C# declaration recovers its visibility and static modifier",
    modifiersOf("csharp", "Spanned"),
    ["public", "static"],
  );
  TestValidator.equals(
    "a multi-line PHP declaration recovers its visibility",
    modifiersOf("php", "spanned"),
    ["public"],
  );
  TestValidator.equals(
    "a multi-line Java declaration recovers its visibility and static modifier",
    modifiersOf("java", "spanned"),
    ["public", "static"],
  );

  // The inverted-range and past-the-source members are addressable but carry no
  // recovered modifiers — the reader bailed out or read only empty lines.
  TestValidator.predicate(
    "the degenerate slices are still indexed without inventing modifiers",
    (["c", "csharp", "php", "java"] as const).every((language) =>
      dump.nodes.some(
        (node) =>
          node.language === language &&
          node.name === "inverted" &&
          node.modifiers === undefined,
      ),
    ),
  );

  // A C# scan whose server answers documentSymbol with no symbols at all: the
  // flat owner-kind recovery must tolerate the missing list rather than read it.
  const nullRoot = GraphPaths.createTempDirectory("samchon-graph-null-symbols-");
  fs.writeFileSync(path.join(nullRoot, "Empty.cs"), "// no symbols here\n");
  const nullDump = await buildGraphDump({
    cwd: nullRoot,
    mode: "lsp",
    languages: ["csharp"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer, "--null-symbols"],
    lspReferenceLimit: 0,
  });
  TestValidator.equals(
    "a C# scan with no symbols yields no nodes",
    nullDump.nodes.length,
    0,
  );
};
