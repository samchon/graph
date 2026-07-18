import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";
import fs from "node:fs";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";

const javaFixture = (): string => {
  const root = GraphPaths.createTempDirectory("samchon-java-flat-");
  fs.mkdirSync(path.join(root, "src", "sample"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "src", "sample", "Api.java"),
    [
      "package sample;",
      "public class Api {",
      // Annotation arguments are text. This one holds an unbalanced `(` inside
      // a character literal, an escaped quote, and two words that are Java
      // modifiers — none of which is this member's visibility.
      `  @Marker('(') @SuppressWarnings("public \\" static") private void hidden() {}`,
      "  public void shown() { new Adapter() {}; }",
      "  void packageOnly() {}",
      "}",
      "class Internal {}",
    ].join("\n"),
  );
  return root;
};

export const test_java_visibility_survives_the_flat_symbol_shape = async () => {
  const root = javaFixture();

  // `hierarchicalDocumentSymbolSupport` is advertised, not guaranteed: a Java
  // server may still answer `documentSymbol` with the flat SymbolInformation
  // shape, which has no children, no modifier fields, and a name decorated with
  // the parameter list. Every visibility fact then has to be recovered from the
  // declaration line, and a graph that only managed it in the hierarchical
  // shape would publish a package-private class as consumer API to whichever
  // caller happened to get the flat reply.
  const dump = await buildGraphDump({
    cwd: root,
    mode: "lsp",
    languages: ["java"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer, "--java-flat"],
    lspReferenceLimit: 0,
  });
  TestValidator.equals("the flat Java symbols come from the server", dump.indexer, "lsp");

  const named = (name: string) => dump.nodes.find((node) => node.name === name);

  // A Java compilation unit exposes only its public top-level types.
  TestValidator.equals(
    "a public top-level Java type is the compilation unit's export",
    named("Api")?.exported,
    true,
  );
  TestValidator.equals(
    "a package-private top-level type is addressable but not consumer API",
    named("Internal")?.exported,
    undefined,
  );

  // Annotations are erased, arguments and all, before the modifiers are read.
  // A scan that stopped at the first `)` would stop inside a character literal
  // and never reach the real `private`; one that read the argument text would
  // report this member `public static` on the strength of a string constant.
  TestValidator.equals(
    "annotation argument text is never read as a member's visibility",
    named("hidden()")?.modifiers,
    ["private"],
  );
  TestValidator.equals(
    "a public member's visibility is recovered from its declaration line",
    named("shown()")?.modifiers,
    ["public"],
  );
  TestValidator.equals(
    "a package-private member declares no visibility modifier",
    named("packageOnly()")?.modifiers,
    undefined,
  );

  // Ownership arrives only as `containerName` in this shape; a member that lost
  // it would read back as a second top-level declaration of the compilation
  // unit, and inherit the export surface of one.
  TestValidator.equals(
    "a flat member is owned by the type its container names",
    named("hidden()")?.qualifiedName,
    "Api.hidden()",
  );
  TestValidator.equals(
    "a flat member is never a compilation-unit export",
    named("hidden()")?.exported,
    undefined,
  );

  // JDT.LS names an anonymous class body `new Adapter() {...}`. It is a real
  // addressable identity, but it is scoped to the method that wrote it, and a
  // tour that ranked it beside declared types would surface a closure as API.
  TestValidator.equals(
    "a flat anonymous-class identity stays closure-scoped",
    named("new Adapter() {...}")?.closure,
    true,
  );

  // No server at all is the third shape this file can be read in. The static
  // fallback parses the same declaration lines with its own annotation eraser,
  // and a project whose Java server is missing must not get a different export
  // surface for it — least of all one decided by an annotation's string
  // constant.
  const statically = await buildGraphDump({
    cwd: root,
    mode: "static",
    languages: ["java"],
  });
  const staticNamed = (qualifiedName: string) =>
    statically.nodes.find(
      (node) => (node.qualifiedName ?? node.name) === qualifiedName,
    );
  TestValidator.equals(
    "the static lane reads the same visibility through the same annotations",
    [
      staticNamed("Api.hidden")?.modifiers,
      staticNamed("Api.shown")?.modifiers,
      staticNamed("Api.packageOnly")?.modifiers,
    ],
    [["private"], ["public"], undefined],
  );
  TestValidator.equals(
    "the static lane agrees on the compilation unit's export surface",
    [staticNamed("Api")?.exported, staticNamed("Internal")?.exported],
    [true, undefined],
  );
};
