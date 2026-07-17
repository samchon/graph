import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";
import type {
  GraphLanguage,
  ISamchonGraphDump,
} from "@samchon/graph";

export const test_static_dependencies_mask_literals_and_reject_ambiguous_names =
  async () => {
    await validateResolutionEvidence();
    await validateLexicalMasking();
  };

async function validateResolutionEvidence(): Promise<void> {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "samchon-static-resolution-"),
  );
  fs.writeFileSync(
    path.join(root, "owners.ts"),
    [
      "class A {",
      "  run() {}",
      "  route() {",
      "    run();",
      "    this.run();",
      "    B.run();",
      "  }",
      "}",
      "class B {",
      "  run() {}",
      "}",
      "function ambiguous(obj: unknown) {",
      "  obj.run();",
      "}",
      "function local() {}",
      "function sameFile() { local(); }",
      "class Model {}",
      "function typed(value: Model) {}",
      "function handler() {}",
      "function wire() { subscribe(handler); }",
      "class ForeignOwner {",
      "  foreign() {}",
      "}",
      "class Caller {",
      "  misroute() { foreign(); }",
      "  inherited() { super.foreign(); }",
      "}",
      "function unknownReceiver(client: unknown) { client.foreign(); }",
      "function topLevelCannotCallMethod() { foreign(); }",
      "class SelfA {",
      "  selfTarget() {}",
      "  viaThis() { this.selfTarget(); }",
      "}",
      "class SelfB {",
      "  selfTarget() {}",
      "}",
      "function crossAttempt() { crossLanguage(); }",
      "function opaqueReceiver() { factory().run(); }",
      "function topLevelSelf() { this.run(); }",
      "class OwnerNode {",
      "  helper() {}",
      "  value = this.helper();",
      "}",
      "namespace N {",
      "  class Model {}",
      "  class Service {",
      "    create() { Model(); }",
      "  }",
      "}",
      "namespace O {",
      "  class Model {}",
      "}",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(root, "other.ts"),
    [
      "function local() {}",
      "function globallyUnique() {}",
      "function entry() { globallyUnique(); }",
    ].join("\n"),
  );
  fs.writeFileSync(path.join(root, "other.go"), "func crossLanguage() {}\n");
  fs.writeFileSync(
    path.join(root, "owners.php"),
    [
      "<?php",
      "class PhpOwner {",
      "  public function target() {}",
      "  public function viaSelf() { self::target(); }",
      "  public function viaStatic() { static::target(); }",
      "}",
    ].join("\n"),
  );

  const dump = await buildGraphDump({
    cwd: root,
    mode: "static",
    languages: ["typescript", "go", "php"],
  });
  const named = (qualified: string, file?: string) =>
    dump.nodes.find(
      (node) =>
        (node.qualifiedName ?? node.name) === qualified &&
        (file === undefined || node.file.endsWith(file)),
    );
  const route = named("A.route");
  const aRun = named("A.run");
  const bRun = named("B.run");
  const calls = dump.edges.filter(
    (edge) => edge.kind === "calls" && edge.from === route?.id,
  );

  TestValidator.equals(
    "an unqualified call resolves to the source lexical owner",
    calls.find((edge) => edge.to === aRun?.id)?.evidence,
    {
      file: "owners.ts",
      startLine: 4,
      startCol: 5,
      endLine: 4,
      endCol: 8,
    },
  );
  TestValidator.equals(
    "an explicit class receiver selects that owner's same-name method",
    calls.find((edge) => edge.to === bRun?.id)?.evidence,
    {
      file: "owners.ts",
      startLine: 6,
      startCol: 7,
      endLine: 6,
      endCol: 10,
    },
  );
  const ambiguous = named("ambiguous");
  TestValidator.equals(
    "an untyped object receiver does not pick a same-name method by file order",
    dump.edges.some(
      (edge) =>
        edge.kind === "calls" &&
        edge.from === ambiguous?.id &&
        (edge.to === aRun?.id || edge.to === bRun?.id),
    ),
    false,
  );
  for (const caller of ["opaqueReceiver", "topLevelSelf"]) {
    TestValidator.equals(
      `${caller} cannot invent a lexical owner for a same-name member`,
      dump.edges.some(
        (edge) =>
          edge.kind === "calls" &&
          edge.from === named(caller)?.id &&
          (edge.to === aRun?.id || edge.to === bRun?.id),
      ),
      false,
    );
  }

  const sameFile = named("sameFile");
  const localHere = named("local", "owners.ts");
  TestValidator.predicate(
    "a sole same-file declaration wins over a same-name declaration elsewhere",
    dump.edges.some(
      (edge) =>
        edge.kind === "calls" &&
        edge.from === sameFile?.id &&
        edge.to === localHere?.id,
    ),
  );
  const entry = named("entry");
  const globallyUnique = named("globallyUnique");
  TestValidator.predicate(
    "a globally unique declaration remains resolvable",
    dump.edges.some(
      (edge) =>
        edge.kind === "calls" &&
        edge.from === entry?.id &&
        edge.to === globallyUnique?.id,
    ),
  );

  const model = named("Model");
  const typed = named("typed");
  TestValidator.equals(
    "a type reference retains its expression coordinate",
    dump.edges.find(
      (edge) =>
        edge.kind === "type_ref" &&
        edge.from === typed?.id &&
        edge.to === model?.id,
    )?.evidence,
    {
      file: "owners.ts",
      startLine: 18,
      startCol: 23,
      endLine: 18,
      endCol: 28,
    },
  );
  const handler = named("handler");
  const wire = named("wire");
  // `subscribe(handler)` hands the callable over; it does not invoke it, and
  // whether `subscribe` ever runs it is not something the source states. So the
  // edge is a value access, which is what the reference implementation resolves
  // it to as well — @ttsc/graph's own `handedOffValues` walks argument-position
  // identifiers to `EdgeValueAccess`, never `EdgeValueCall`.
  TestValidator.equals(
    "a callable handoff retains its argument coordinate",
    dump.edges.find(
      (edge) =>
        edge.kind === "accesses" &&
        edge.from === wire?.id &&
        edge.to === handler?.id,
    )?.evidence,
    {
      file: "owners.ts",
      startLine: 20,
      startCol: 29,
      endLine: 20,
      endCol: 36,
    },
  );

  const foreign = named("ForeignOwner.foreign");
  const rejectsForeign = (caller: string) =>
    dump.edges.some(
      (edge) =>
        edge.kind === "calls" &&
        edge.from === named(caller)?.id &&
        edge.to === foreign?.id,
    );
  TestValidator.equals(
    "a bare member name cannot jump to another lexical owner",
    rejectsForeign("Caller.misroute"),
    false,
  );
  TestValidator.equals(
    "module scope cannot call a uniquely named owned member",
    rejectsForeign("topLevelCannotCallMethod"),
    false,
  );
  TestValidator.equals(
    "an unknown receiver stays unresolved even when the member name is unique",
    rejectsForeign("unknownReceiver"),
    false,
  );
  TestValidator.equals(
    "base or super syntax without a proven inheritance target stays unresolved",
    rejectsForeign("Caller.inherited"),
    false,
  );
  TestValidator.predicate(
    "a language self receiver resolves within the source lexical owner",
    dump.edges.some(
      (edge) =>
        edge.kind === "calls" &&
        edge.from === named("SelfA.viaThis")?.id &&
      edge.to === named("SelfA.selfTarget")?.id,
    ),
  );
  TestValidator.equals(
    "a same-name declaration in another language is not a static call target",
    dump.edges.some(
      (edge) =>
        edge.kind === "calls" &&
        edge.from === named("crossAttempt")?.id &&
        edge.to === named("crossLanguage")?.id,
    ),
    false,
  );
  TestValidator.predicate(
    "a type-body initializer uses the type itself as its lexical owner",
    dump.edges.some(
      (edge) =>
        edge.kind === "calls" &&
        edge.from === named("OwnerNode")?.id &&
      edge.to === named("OwnerNode.helper")?.id,
    ),
  );
  TestValidator.predicate(
    "a bare type resolves through the nearest enclosing namespace",
    dump.edges.some(
      (edge) =>
        edge.kind === "instantiates" &&
        edge.from === named("N.Service.create")?.id &&
      edge.to === named("N.Model")?.id,
    ),
  );
  for (const caller of ["PhpOwner.viaSelf", "PhpOwner.viaStatic"]) {
    TestValidator.predicate(
      `${caller} resolves the language-defined current type receiver`,
      dump.edges.some(
        (edge) =>
          edge.kind === "calls" &&
          edge.from === named(caller)?.id &&
          edge.to === named("PhpOwner.target")?.id,
      ),
    );
  }
}

async function validateLexicalMasking(): Promise<void> {
  const fixtures: Array<{
    extension: string;
    language: Exclude<GraphLanguage, "unknown">;
    source: string[];
    caller?: string;
    target: string;
  }> = [
    {
      extension: "ts",
      language: "typescript",
      target: "ghost",
      caller: "noise",
      source: [
        "function ghost() {}",
        "function noise() {",
        '  consume("ghost()");',
        "  consume(`ghost()`);",
        "  consume(/ghost\\(\\)/);",
        "  // ghost();",
        "  /* ghost(); */",
        "}",
      ],
    },
    {
      extension: "go",
      language: "go",
      target: "ghost",
      caller: "noise",
      source: [
        "func ghost() {}",
        "func noise() {",
        "  consume(`ghost()`)",
        "  // ghost()",
        "}",
      ],
    },
    {
      extension: "rs",
      language: "rust",
      target: "ghost",
      caller: "noise",
      source: [
        "fn ghost() {}",
        "fn noise() {",
        '    consume(r##"ghost()"##);',
        '    consume(b"ghost()");',
        "    consume('g');",
        "    let _: &'static str = \"safe\";",
        "    /* outer /* ghost() */ ghost() */",
        "}",
      ],
    },
    {
      extension: "cpp",
      language: "cpp",
      target: "ghost",
      caller: "noise",
      source: [
        "void ghost() {}",
        "void noise() {",
        '  auto raw = R"tag(ghost())tag";',
        '  consume(u8"ghost()");',
        "  // ghost();",
        "}",
      ],
    },
    {
      extension: "c",
      language: "c",
      target: "ghost",
      caller: "noise",
      source: [
        "void ghost() {",
        "}",
        "void noise() {",
        '  consume("ghost()");',
        "  /* ghost(); */",
        "}",
      ],
    },
    {
      extension: "java",
      language: "java",
      target: "ghost",
      caller: "noise",
      source: [
        "class Mask {",
        "  void ghost() {}",
        "  void noise() {",
        '    consume("""ghost()""");',
        "    // ghost();",
        "  }",
        "}",
      ],
    },
    {
      extension: "cs",
      language: "csharp",
      target: "ghost",
      caller: "noise",
      source: [
        "class Mask {",
        "  void ghost() {}",
        "  void noise() {",
        '    consume(@"ghost() "" ghost()");',
        '    consume("""ghost()""");',
        "  }",
        "}",
      ],
    },
    {
      extension: "kt",
      language: "kotlin",
      target: "ghost",
      caller: "noise",
      source: [
        "class Mask {",
        "  fun ghost() {}",
        "  fun noise() {",
        '    consume("""ghost()""")',
        "  }",
        "}",
      ],
    },
    {
      extension: "swift",
      language: "swift",
      target: "ghost",
      caller: "noise",
      source: [
        "class Mask {",
        "  func ghost() {}",
        "  func noise() {",
        '    consume(#"ghost()"#)',
        "    consume(/ghost\\(\\)/)",
        "    consume(#/ghost\\(\\)/#)",
        "  }",
        "}",
      ],
    },
    {
      extension: "scala",
      language: "scala",
      target: "ghost",
      caller: "noise",
      source: [
        "class Mask {",
        "  def ghost() {}",
        "  def noise() {",
        '    consume(raw"""ghost()""")',
        "  }",
        "}",
      ],
    },
    {
      extension: "zig",
      language: "zig",
      target: "ghost",
      caller: "noise",
      source: [
        "fn ghost() {}",
        "fn noise() {",
        "    \\\\ghost()",
        "}",
      ],
    },
    {
      extension: "py",
      language: "python",
      target: "ghost",
      source: [
        "def ghost(): pass",
        'consume(r"""ghost()""")',
        "# ghost()",
      ],
    },
    {
      extension: "rb",
      language: "ruby",
      target: "ghost!",
      caller: "noise",
      source: [
        "def ghost!", "end",
        "def noise",
        "  %q{ghost!()}",
        "  <<~TEXT",
        "    ghost!()",
        "  TEXT",
        "  %r{ghost!\\(\\)}",
        "  # ghost!()",
        "end",
        "=begin",
        "ghost!()",
        "=end",
        "__END__",
        "ghost!()",
      ],
    },
    {
      extension: "php",
      language: "php",
      target: "ghost",
      caller: "noise",
      source: [
        "<?php",
        "function ghost() {}",
        "function noise() {",
        "  $text = <<<'TEXT'",
        "ghost()",
        "TEXT;",
        "  // ghost();",
        "}",
      ],
    },
    {
      extension: "lua",
      language: "lua",
      target: "ghost",
      source: [
        "function ghost() end",
        "consume([=[ghost()]=])",
        "--[=[ghost()]=]",
      ],
    },
    {
      extension: "dart",
      language: "dart",
      target: "Ghost",
      source: [
        "class Ghost {}",
        'consume(r"""Ghost()""");',
        "// Ghost()",
      ],
    },
  ];

  for (const fixture of fixtures) {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), `samchon-static-mask-${fixture.language}-`),
    );
    fs.writeFileSync(
      path.join(root, `fixture.${fixture.extension}`),
      fixture.source.join("\n"),
    );
    const dump = await buildGraphDump({
      cwd: root,
      mode: "static",
      languages: [fixture.language],
    });
    assertNoDependency(
      dump,
      fixture.language,
      `fixture.${fixture.extension}`,
      fixture.caller,
      fixture.target,
    );
  }
}

function assertNoDependency(
  dump: ISamchonGraphDump,
  language: string,
  file: string,
  callerName: string | undefined,
  targetName: string,
): void {
  const caller =
    callerName === undefined
      ? undefined
      : dump.nodes.find((node) => node.name === callerName);
  const sourceIds = new Set([file, ...(caller === undefined ? [] : [caller.id])]);
  const target = dump.nodes.find((node) => node.name === targetName);
  TestValidator.predicate(
    `${language}: masking fixture declarations exist`,
    (callerName === undefined || caller !== undefined) && target !== undefined,
  );
  TestValidator.equals(
    `${language}: strings and comments do not create dependency edges`,
    dump.edges.some(
      (edge) =>
        sourceIds.has(edge.from) &&
        edge.to === target?.id &&
        (edge.kind === "calls" ||
          edge.kind === "instantiates" ||
          edge.kind === "type_ref"),
    ),
    false,
  );
}
