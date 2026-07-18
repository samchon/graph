import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";
import fs from "node:fs";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";

const cFixture = (): string => {
  const root = GraphPaths.createTempDirectory("samchon-c-lsp-linkage-");
  fs.writeFileSync(
    path.join(root, "service.c"),
    [
      "#include <stdio.h>",
      "static int helper(void) {",
      "  return 1;",
      "}",
      "int public_api(void) {",
      "  return helper();",
      "}",
      "static const int LIMIT = 8;",
      "int shared_counter = 0;",
      // A C declaration head may be wrapped: the storage class sits on the line
      // above the name it applies to.
      "static void",
      "wrapped_helper(void) {",
      "}",
    ].join("\n"),
  );
  return root;
};

const dumpWith = (root: string, extra: string[]) =>
  buildGraphDump({
    cwd: root,
    mode: "lsp",
    languages: ["c"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer, "--c-symbols", ...extra],
    lspReferenceLimit: 0,
  });

export const test_c_lsp_linkage_survives_both_symbol_shapes = async () => {
  // `static` in C is the language's own privacy rule: a file-local definition
  // is not consumer API, and seeding an exported-surface tour with it sends a
  // reader to a symbol no other translation unit can even name. clangd does not
  // report that distinction as a symbol property — it reports a `static`
  // function exactly like an external one — so the graph has to read the
  // storage class off the declaration itself.
  //
  // Which it must do in BOTH document-symbol shapes. Hierarchical or flat is
  // the server's choice, not a fact about the code, and an export surface that
  // silently depended on that choice would publish `helper` to one caller and
  // hide it from the next.
  for (const [shape, args] of [
    ["hierarchical", []],
    ["flat", ["--symbol-information"]],
  ] as const) {
    const dump = await dumpWith(cFixture(), [...args]);
    TestValidator.equals(`${shape}: the C symbols come from the server`, dump.indexer, "lsp");

    const named = (name: string) => dump.nodes.find((node) => node.name === name);
    TestValidator.predicate(
      `${shape}: every C declaration is indexed`,
      ["helper", "public_api", "LIMIT", "shared_counter", "wrapped_helper"].every(
        (name) => named(name) !== undefined,
      ),
    );
    TestValidator.equals(
      `${shape}: a static C function is not on the public surface`,
      named("helper")?.exported === true,
      false,
    );
    TestValidator.equals(
      `${shape}: a C function with external linkage stays on the public surface`,
      named("public_api")?.exported,
      true,
    );
    // The storage class is retained as a fact, not merely consumed: a reader
    // asking why `helper` is absent from the surface gets the reason.
    TestValidator.equals(
      `${shape}: static linkage is recorded on the declaration`,
      named("helper")?.modifiers,
      ["static"],
    );
    TestValidator.equals(
      `${shape}: external linkage adds no storage-class modifier`,
      named("public_api")?.modifiers,
      undefined,
    );
    // A variable obeys the same rule as a function; the linkage is a property
    // of the declaration, not of its kind.
    TestValidator.equals(
      `${shape}: a static C variable is file-local too`,
      named("LIMIT")?.exported === true,
      false,
    );
    TestValidator.equals(
      `${shape}: a plain C variable keeps external linkage`,
      named("shared_counter")?.exported,
      true,
    );
  }

  // A wrapped declaration head is only recoverable where the server reports a
  // declaration range that precedes the name. The hierarchical shape does —
  // `range` opens on `static void` while `selectionRange` marks the name a line
  // below — so the storage class is still read across that line break, and a
  // helper split for line length does not quietly join the public surface.
  //
  // The flat shape carries no such range (a SymbolInformation locates only the
  // name itself), so this one fact is not recoverable there; it is asserted
  // where the protocol supplies the evidence for it.
  const hierarchical = await dumpWith(cFixture(), []);
  const wrapped = hierarchical.nodes.find(
    (node) => node.name === "wrapped_helper",
  );
  TestValidator.equals(
    "a static C head split across lines still reads as file-local",
    [wrapped?.modifiers, wrapped?.exported === true],
    [["static"], false],
  );
};
