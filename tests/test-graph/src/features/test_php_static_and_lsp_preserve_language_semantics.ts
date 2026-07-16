import { TestValidator } from "@nestia/e2e";
import { buildGraphDump, ISamchonGraphDump } from "@samchon/graph";
import fs from "node:fs";
import path from "node:path";

import { GraphFixtures } from "../internal/GraphFixtures";
import { GraphPaths } from "../internal/GraphPaths";

export const test_php_static_and_lsp_preserve_language_semantics = async () => {
  const root = GraphFixtures.createPhpSemanticsFixture();
  const statically = await buildGraphDump({
    cwd: root,
    mode: "static",
    languages: ["php"],
  });
  validate("static", statically);
  writeNamespaceFixtures(root);

  for (const [lane, extraArgs] of [
    ["lsp-document", []],
    ["lsp-flat", ["--symbol-information"]],
  ] as const) {
    const dump = await buildGraphDump({
      cwd: root,
      mode: "lsp",
      languages: ["php"],
      server: process.execPath,
      serverArgs: [
        GraphPaths.fakeLspServer,
        "--php-symbols",
        ...extraArgs,
      ],
      lspReferenceLimit: 0,
    });
    TestValidator.equals(
      `${lane}: fake server stays in LSP mode`,
      dump.indexer,
      "lsp",
    );
    validate(lane, dump);
    validateNamespaceScopes(lane, dump);
  }
};

function validate(lane: string, dump: ISamchonGraphDump): void {
  const named = (qualifiedName: string) =>
    dump.nodes.find((node) => {
      const identity = node.qualifiedName ?? node.name;
      return identity === qualifiedName;
    });
  const label = (fact: string) => `${lane}: ${fact}`;

  TestValidator.predicate(
    label("a namespace owns PHP types and functions"),
    named("Demo")?.kind === "namespace" &&
      named("Demo.Pipeline")?.kind === "class" &&
      named("Demo.Handler")?.kind === "interface" &&
      named("Demo.bootstrap")?.kind === "function",
  );
  TestValidator.equals(
    label("PHP methods and __construct keep executable kinds"),
    [
      named("Demo.Pipeline.__construct")?.kind,
      named("Demo.Pipeline.handle")?.kind,
      named("Demo.Handler.process")?.kind,
    ],
    ["constructor", "method", "method"],
  );
  TestValidator.equals(
    label("PHP properties keep property shape"),
    [
      named("Demo.Pipeline.secret")?.kind,
      named("Demo.Pipeline.shared")?.kind,
    ],
    ["property", "property"],
  );

  TestValidator.equals(
    label("only namespace-level PHP declarations are exported"),
    [
      named("Demo")?.exported,
      named("Demo.Pipeline")?.exported,
      named("Demo.Handler")?.exported,
      named("Demo.bootstrap")?.exported,
      named("Demo.Pipeline.handle")?.exported,
      named("Demo.Handler.process")?.exported,
    ],
    [undefined, true, true, true, undefined, undefined],
  );
  TestValidator.equals(
    label("PHP explicit and implicit visibility is preserved"),
    [
      named("Demo.Pipeline.__construct")?.modifiers,
      named("Demo.Pipeline.handle")?.modifiers,
      named("Demo.Pipeline.extensionPoint")?.modifiers,
      named("Demo.Pipeline.hidden")?.modifiers,
      named("Demo.Handler.process")?.modifiers,
    ],
    [
      ["public"],
      ["public"],
      ["protected"],
      ["private"],
      ["public"],
    ],
  );
  TestValidator.equals(
    label("PHP type and property modifiers survive indexing"),
    [
      named("Demo.Pipeline")?.modifiers,
      named("Demo.Pipeline.secret")?.modifiers,
      named("Demo.Pipeline.shared")?.modifiers,
    ],
    [["readonly"], ["private"], ["public", "static"]],
  );
  TestValidator.predicate(
    label("canonical namespace owners produce containment edges"),
    contains(dump, "Demo", "Demo.Pipeline") &&
      contains(dump, "Demo", "Demo.Handler") &&
      contains(dump, "Demo", "Demo.bootstrap") &&
      contains(dump, "Demo.Pipeline", "Demo.Pipeline.handle") &&
      contains(dump, "Demo.Handler", "Demo.Handler.process"),
  );
}

function validateNamespaceScopes(
  lane: string,
  dump: ISamchonGraphDump,
): void {
  const named = (qualifiedName: string) =>
    dump.nodes.find(
      (node) => (node.qualifiedName ?? node.name) === qualifiedName,
    );
  const label = (fact: string) => `${lane}: ${fact}`;

  TestValidator.equals(
    label(
      "semicolon namespaces follow the selection offset until the next declaration",
    ),
    [
      named("Alpha.One")?.kind,
      named("Alpha.One.First")?.kind,
      named("Alpha.One.AfterTraps")?.kind,
      named("Beta")?.kind,
      named("Beta.second")?.kind,
      named("Gamma.Deep")?.kind,
      named("Gamma.Deep.Last")?.kind,
    ],
    [
      "namespace",
      "class",
      "class",
      "namespace",
      "function",
      "namespace",
      "class",
    ],
  );
  TestValidator.equals(
    label(
      "braced and global namespace scopes stay distinct on the same line",
    ),
    [
      named("Red.Blue")?.kind,
      named("Red.Blue.Box")?.kind,
      named("Red.Blue.Box.open")?.kind,
      named("global_helper")?.kind,
      named("Green")?.kind,
      named("Green.Contract")?.kind,
      named("Green.Contract.run")?.kind,
    ],
    [
      "namespace",
      "class",
      "method",
      "function",
      "namespace",
      "interface",
      "method",
    ],
  );
  TestValidator.equals(
    label("only namespace-direct and global declarations are exported"),
    [
      named("Alpha.One")?.exported,
      named("Alpha.One.First")?.exported,
      named("Alpha.One.AfterTraps")?.exported,
      named("Beta.second")?.exported,
      named("Red.Blue.Box")?.exported,
      named("Red.Blue.Box.open")?.exported,
      named("global_helper")?.exported,
      named("Green.Contract")?.exported,
      named("Green.Contract.run")?.exported,
    ],
    [undefined, true, true, true, true, undefined, true, true, undefined],
  );
  TestValidator.predicate(
    label("normalized owners produce namespace and member containment"),
    contains(dump, "Alpha.One", "Alpha.One.First") &&
      contains(dump, "Alpha.One", "Alpha.One.AfterTraps") &&
      contains(dump, "Beta", "Beta.second") &&
      contains(dump, "Gamma.Deep", "Gamma.Deep.Last") &&
      contains(dump, "Red.Blue", "Red.Blue.Box") &&
      contains(dump, "Red.Blue.Box", "Red.Blue.Box.open") &&
      contains(dump, "Green", "Green.Contract") &&
      contains(dump, "Green.Contract", "Green.Contract.run"),
  );
  TestValidator.predicate(
    label(
      "comments, strings, heredoc, and nowdoc do not create namespace owners",
    ),
    dump.nodes.every((node) => {
      const identity = node.qualifiedName ?? node.name;
      return ![
        "StringTrap",
        "DoubleTrap",
        "BlockTrap",
        "LineTrap",
        "HeredocTrap",
        "NowdocTrap",
      ].some((trap) => identity.includes(trap));
    }),
  );
  TestValidator.predicate(
    label(
      "empty, class-only, and qualified flat containers never duplicate namespaces",
    ),
    dump.nodes.every((node) => {
      const identity = node.qualifiedName ?? node.name;
      return (
        !identity.includes("Demo.Demo") &&
        !identity.includes("Alpha.One.Alpha.One") &&
        !identity.includes("Gamma.Deep.Gamma.Deep") &&
        !identity.includes("Green.Green")
      );
    }),
  );
}

function contains(
  dump: ISamchonGraphDump,
  parentName: string,
  childName: string,
): boolean {
  const parent = dump.nodes.find(
    (node) => (node.qualifiedName ?? node.name) === parentName,
  );
  const child = dump.nodes.find(
    (node) => (node.qualifiedName ?? node.name) === childName,
  );
  return (
    parent !== undefined &&
    child !== undefined &&
    dump.edges.some(
      (edge) =>
        edge.kind === "contains" &&
        edge.from === parent.id &&
        edge.to === child.id,
    )
  );
}

function writeNamespaceFixtures(root: string): void {
  fs.writeFileSync(
    path.join(root, "src", "Namespaces.php"),
    [
      "<?php",
      "namespace Alpha\\One; class First {}",
      "$single = 'namespace StringTrap;'; $double = \"namespace DoubleTrap;\";",
      "/* namespace BlockTrap; */ // namespace LineTrap;",
      "$heredoc = <<<TEXT",
      "namespace HeredocTrap {",
      "}",
      "TEXT;",
      "$nowdoc = <<<'RAW'",
      "namespace NowdocTrap;",
      "RAW;",
      "class AfterTraps {}",
      "namespace Beta; function second() {}",
      "namespace Gamma\\Deep; class Last {}",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(root, "src", "Bracketed.php"),
    [
      "<?php",
      "namespace Red\\Blue { class Box { function open() {} } }",
      "namespace { function global_helper() {} }",
      "namespace Green { interface Contract { function run(); } }",
    ].join("\n"),
  );
}
