import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const GRAPH_NODE_KINDS = [
  "file",
  "package",
  "namespace",
  "module",
  "function",
  "class",
  "interface",
  "type",
  "enum",
  "variable",
  "method",
  "property",
  "parameter",
  "field",
  "constructor",
  "external_symbol",
];

const GRAPH_EDGE_KINDS = [
  "contains",
  "exports",
  "imports",
  "calls",
  "accesses",
  "instantiates",
  "type_ref",
  "extends",
  "implements",
  "overrides",
  "dispatches",
  "decorates",
  "renders",
  "tests",
  "references",
];

// `dispatches` is the one edge kind no index ever stores. It is the runtime
// counterpart of `overrides`/`implements`: the language server resolves a call
// to the declaration it names, and where that declaration has no body, the code
// that runs is its implementation — so a traversal that follows what executes
// synthesizes the hop in place of the dead end (§3a). It is pinned by
// `test_trace_dispatches_to_the_implementation`, not by the stored-graph
// contract below.
const GRAPH_TRAVERSAL_EDGE_KINDS = ["dispatches"];

const GRAPH_REQUEST_TYPES = [
  "entrypoints",
  "lookup",
  "trace",
  "details",
  "overview",
  "tour",
  "escape",
];

const createOrderFixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "src", "service.ts"),
    [
      "import \"./setup\";",
      "export class OrderService {",
      "  create(input: CreateOrder): Order {",
      "    return makeOrder(input);",
      "  }",
      "}",
      "export interface CreateOrder { id: string }",
      "export type Order = { id: string }",
      "export function makeOrder(input: CreateOrder): Order {",
      "  return { id: input.id };",
      "}",
    ].join("\n"),
  );
  fs.writeFileSync(path.join(root, "src", "setup.ts"), "export const ready = true;\n");
  fs.writeFileSync(
    path.join(root, "src", "main.go"),
    [
      "package main",
      "import (",
      "  \"fmt\"",
      "  alias \"strings\"",
      ")",
      "type Repository struct{}",
      "func LoadOrder() string {",
      "  return fmt.Sprintf(alias.TrimSpace(FormatOrder()))",
      "}",
      "func FormatOrder() string {",
      "  return \"ok\"",
      "}",
    ].join("\n"),
  );
  return root;
};

const createCmakeFixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-cmake-root-"));
  fs.writeFileSync(path.join(root, "CMakeLists.txt"), "cmake_minimum_required(VERSION 3.10)\n");
  return root;
};

const createLspFixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-lsp-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "src", "lsp.ts"),
    [
      "export class LspService {",
      "  run(): void {",
      "    helper();",
      "  }",
      "}",
      "const warning = true;",
      "function helper(): void {",
      "  return;",
      "}",
      // Exercise the two module-export forms an inline `export` modifier scan
      // cannot see: a separate list (with an `as` alias) and a default export.
      "export { helper as publicHelper };",
      "export default LspService;",
    ].join("\n"),
  );
  return root;
};

const createDualOwnerFixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-dual-owner-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  // `method`'s call is deliberately split across two lines (`target` / `();`)
  // so the same fixture also covers a reference whose reported range spans
  // two lines — the `(` check must read the end line's text, not the start
  // line's.
  fs.writeFileSync(
    path.join(root, "src", "dual.ts"),
    [
      "class Owner {",
      "  helper = () => {",
      "    target();",
      "  };",
      "  method() {",
      "    target",
      "      ();",
      "  }",
      "}",
      "function target() {}",
    ].join("\n"),
  );
  return root;
};

const createTriviaFixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-trivia-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  // The fake server reports each reference's range starting on the token's
  // leading trivia (a full-start does this), so the indexer must advance to
  // the real token before reading it. This file lays out one reference per
  // trivia shape at fixed lines the fake server points at:
  //   line 1: `new Store`   — instantiates (keyword directly before the name)
  //   line 2: `typeof Store` — type_ref
  //   line 3: `blockFn`      — reference range starts inside a block comment
  //   line 5→6: `lineFn`     — range starts on a `//` line, wraps to the token
  //   line 7: `<NS.Panel />` — a namespaced JSX tag (render + dotted access)
  //   line 8: `optFn?.()`    — an optional call
  fs.writeFileSync(
    path.join(root, "src", "trivia.ts"),
    [
      "class Owner {",
      "  makeNew = new Store();",
      "  useType: typeof Store = this.makeNew;",
      "  viaBlock = /* pre */ blockFn();",
      "  viaLine =",
      "    // pick",
      "    lineFn();",
      "  jsx = <NS.Panel />;",
      "  opt = optFn?.();",
      "}",
      "class Store {}",
      "function blockFn() { return 1; }",
      "function lineFn() { return 2; }",
      "const NS = { Panel: () => null };",
      "function optFn() { return 3; }",
      // §2j, in the language-server lane: line 17 is a top-level statement, so it
      // belongs to the module, and `passedFn` sits in an argument list with no
      // `(` of its own — a callable handed to a call, which the site that hands it
      // over invokes.
      "function passedFn() { return 4; }",
      "function register(fn: unknown) { return fn; }",
      "register(passedFn);",
    ].join("\n"),
  );
  return root;
};

const createClassifyFixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-classify-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  // The fake server points references at line 1 (an invocation — `(` right
  // after column 4), line 2 (a bare member access), line 13 (a JSX opening
  // tag), line 14 (a JSX closing tag), line 15 (a generic type argument —
  // `<` immediately preceded by an identifier char, so it must NOT classify
  // as JSX), line 16 (an invocation through a generic argument list, e.g.
  // `aabb<T>()`), line 17 (an unclosed generic argument list, so the
  // generic-skip gives up and returns the text unchanged), and a line beyond
  // the file (no text) so the reference classifier exercises every branch.
  // Lines 3-12 already belong to the leaf() document symbols below, so the
  // new lines start past all of them to avoid stealing ownership of a
  // reference from the outer `Owner` class.
  fs.writeFileSync(
    path.join(root, "src", "classify.ts"),
    [
      "class Owner {",
      "aabb(call);",
      "aabb.member;",
      "  filler0;",
      "  filler1;",
      "  filler2;",
      "  filler3;",
      "  filler4;",
      "  filler5;",
      "  filler6;",
      "  filler7;",
      "  filler8;",
      "  filler9;",
      "<aabb />;",
      "</aabb>;",
      "Array<aabb>;",
      "aabb<T>();",
      "aabb<Unclosed;",
      "}",
    ].join("\n"),
  );
  return root;
};

const createInheritanceFixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-inherit-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  const write = (name, lines) =>
    fs.writeFileSync(path.join(root, "src", name), `${lines.join("\n")}\n`);
  // TypeScript: extends + implements keywords, a member (contains), a generic
  // supertype (angle brackets stripped), and an unresolved supertype (skipped).
  // Base lives in another file to exercise cross-file resolution.
  write("base.ts", [
    "export class Base {",
    "  run(): void {}",
    "}",
    "export class Container {}",
  ]);
  write("service.ts", [
    "export interface Runner {}",
    "export interface Loggable {}",
    "export function Injectable() {}",
    "@Injectable()",
    "@Missing()",
    "export class Service extends Base implements Runner, Loggable {",
    "  run(): void {}",
    "  extra(): void {}",
    "}",
    "export class Generic extends Container<Item> {",
    "  gen(): void {}",
    "}",
    "export class Orphan extends Missing {}",
  ]);
  // C#: colon supertypes with modifiers, a duplicate supertype (deduped), and a
  // trailing comma (empty entry skipped).
  write("Models.cs", [
    "public class Entity {}",
    "public class User : Entity {}",
    "public class Dup : Entity, Entity, {}",
  ]);
  // C++: access-modifier-prefixed base list.
  write("derived.cpp", [
    "class Helper {};",
    "class CppBase {};",
    "class Derived : public CppBase, private Helper {};",
  ]);
  // Python parenthesised bases, Ruby `<`, Kotlin constructor call, Scala `with`.
  write("pet.py", [
    "class Animal:",
    "    pass",
    "class Dog(Animal, object):",
    "    pass",
    "class Weird(Animal, metaclass=Meta):",
    "    pass",
    "class Star(*bases):",
    "    pass",
  ]);
  write("car.rb", ["class Vehicle", "end", "class Car < Vehicle", "end"]);
  write("KFoo.kt", ["class KBase", "class KFoo : KBase()"]);
  write("Mixin.scala", ["class Bar", "trait Baz", "class Foo extends Bar with Baz"]);
  return root;
};

const createLspInheritanceFixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-lsp-inherit-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  // Line numbers here must match the selectionRanges the fake server reports in
  // `--inheritance` mode, since the LSP indexer reads the declaration line back
  // from the source to parse supertypes.
  fs.writeFileSync(
    path.join(root, "src", "inh.ts"),
    [
      "export function Deco() {}",
      "export class Parent {}",
      "export interface Iface {}",
      "@Ghost()",
      "@Deco()",
      "export class Child extends Parent implements Iface {}",
      "export class Solo extends Missing {}",
      "export class Dup extends Parent, Parent {}",
    ].join("\n"),
  );
  return root;
};

const createContractFixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-contract-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "src", "contract.ts"),
    [
      "package root",
      "namespace Root",
      "module Root.Module",
      "class Service extends Base implements Runner",
      "constructor(input: Input)",
      "run(input: Input): Output",
      "property value: string",
      "field count: number",
      "function helper(): void",
      "interface Runner",
      "type Input",
      "enum Mode",
      "const settings = {}",
      "parameter input",
      "function Component(): JSX.Element",
      "function Decorator(): void",
      "class Base",
      "method Base.run(): void",
      "function testRun(): void",
    ].join("\n"),
  );
  const file = "src/contract.ts";
  const evidence = (line, text) => ({
    file,
    startLine: line,
    startCol: 1,
    endLine: line,
    endCol: text.length + 1,
    text,
  });
  const node = (id, kind, name, line, extra = {}) => ({
    id,
    kind,
    language: "typescript",
    name,
    file,
    external: false,
    exported: true,
    signature: `${kind} ${name}`,
    evidence: evidence(line, `${kind} ${name}`),
    ...extra,
  });
  const nodes = [
    node(`${file}#root:package`, "package", "root", 1),
    node(`${file}#Root:namespace`, "namespace", "Root", 2),
    node(`${file}#Root.Module:module`, "module", "Module", 3, {
      qualifiedName: "Root.Module",
    }),
    node(`${file}#Root.Service:class`, "class", "Service", 4, {
      qualifiedName: "Root.Service",
    }),
    node(`${file}#Root.Service.constructor:constructor`, "constructor", "constructor", 5, {
      qualifiedName: "Root.Service.constructor",
    }),
    node(`${file}#Root.Service.run:method`, "method", "run", 6, {
      qualifiedName: "Root.Service.run",
      decorators: [{ name: "Route", arguments: [{ literal: "/run" }] }],
    }),
    node(`${file}#Root.Service.value:property`, "property", "value", 7, {
      qualifiedName: "Root.Service.value",
    }),
    node(`${file}#Root.Service.count:field`, "field", "count", 8, {
      qualifiedName: "Root.Service.count",
    }),
    node(`${file}#helper:function`, "function", "helper", 9),
    node(`${file}#Runner:interface`, "interface", "Runner", 10),
    node(`${file}#Input:type`, "type", "Input", 11),
    node(`${file}#Mode:enum`, "enum", "Mode", 12),
    node(`${file}#settings:variable`, "variable", "settings", 13),
    node(`${file}#Root.Service.run.input:parameter`, "parameter", "input", 14, {
      qualifiedName: "Root.Service.run.input",
    }),
    node(`${file}#Component:function`, "function", "Component", 15),
    node(`${file}#Decorator:function`, "function", "Decorator", 16),
    node(`${file}#Base:class`, "class", "Base", 17),
    node(`${file}#Base.run:method`, "method", "run", 18, {
      qualifiedName: "Base.run",
    }),
    node(`${file}#testRun:function`, "function", "testRun", 19),
    {
      id: "external:typescript:ExternalApi",
      kind: "external_symbol",
      language: "typescript",
      name: "ExternalApi",
      file: "",
      external: true,
    },
  ];
  const id = (suffix) => `${file}#${suffix}`;
  const edge = (from, to, kind, line = 6) => ({
    from,
    to,
    kind,
    evidence: evidence(line, `${from} ${kind} ${to}`),
  });
  const run = id("Root.Service.run:method");
  const dump = {
    project: root,
    languages: ["typescript"],
    indexer: "static",
    nodes,
    edges: [
      edge(file, "external:typescript:ExternalApi", "imports", 1),
      // `exports` is an indexer fact now, not a flag the loader re-derives: the
      // module's own export syntax, followed through the project's barrels, is
      // what says how many modules put a symbol on the wire.
      edge(file, id("Root.Service:class"), "exports", 4),
      edge(file, id("helper:function"), "exports", 9),
      edge(run, id("helper:function"), "calls", 6),
      edge(run, id("Root.Service.value:property"), "accesses", 6),
      edge(run, id("Root.Service:class"), "instantiates", 6),
      edge(run, id("Input:type"), "type_ref", 6),
      edge(id("Root.Service:class"), id("Base:class"), "extends", 4),
      edge(id("Root.Service:class"), id("Runner:interface"), "implements", 4),
      edge(run, id("Base.run:method"), "overrides", 6),
      edge(run, id("Decorator:function"), "decorates", 6),
      edge(run, id("Component:function"), "renders", 6),
      edge(id("testRun:function"), run, "tests", 19),
      edge(id("helper:function"), run, "references", 9),
    ],
    diagnostics: [
      {
        file,
        line: 13,
        code: "C001",
        message: "contract warning",
        severity: "warning",
      },
    ],
    warnings: [],
  };
  return { root, dump };
};

const languageFixtures = [
  {
    language: "typescript",
    file: "entry.ts",
    symbol: "TypeScriptEntry",
    source: "export function TypeScriptEntry() { return 1; }\n",
  },
  {
    language: "go",
    file: "entry.go",
    symbol: "GoEntry",
    source: "package main\nfunc GoEntry() string {\n  return \"ok\"\n}\n",
  },
  {
    language: "rust",
    file: "entry.rs",
    symbol: "rust_entry",
    source: "pub fn rust_entry() -> i32 {\n  1\n}\n",
  },
  {
    language: "cpp",
    file: "entry.cpp",
    symbol: "cpp_entry",
    source: "int cpp_entry() {\n  return 1;\n}\n",
  },
  {
    language: "c",
    file: "entry.c",
    symbol: "c_entry",
    source: "int c_entry() {\n  return 1;\n}\n",
  },
  {
    language: "java",
    file: "Entry.java",
    symbol: "JavaEntry",
    package: "com.samchon.graph.java",
    source: "package com.samchon.graph.java;\npublic class JavaEntry {\n}\n",
  },
  {
    language: "csharp",
    file: "Entry.cs",
    symbol: "CSharpEntry",
    source: "public class CSharpEntry {\n}\n",
  },
  {
    language: "kotlin",
    file: "Entry.kt",
    symbol: "kotlinEntry",
    package: "com.samchon.graph.kotlin",
    source: "package com.samchon.graph.kotlin\nfun kotlinEntry(): Int {\n  return 1\n}\n",
  },
  {
    language: "swift",
    file: "Entry.swift",
    symbol: "swiftEntry",
    source: "func swiftEntry() -> Int {\n  return 1\n}\n",
  },
  {
    language: "scala",
    file: "Entry.scala",
    symbol: "scalaEntry",
    package: "com.samchon.graph.scala",
    source: "package com.samchon.graph.scala\ndef scalaEntry(): Int = 1\n",
  },
  {
    language: "zig",
    file: "entry.zig",
    symbol: "zigEntry",
    source: "pub fn zigEntry() i32 {\n  return 1;\n}\n",
  },
  {
    language: "python",
    file: "entry.py",
    symbol: "PythonEntry",
    source: "def PythonEntry():\n    return 1\n",
  },
  {
    language: "ruby",
    file: "entry.rb",
    symbol: "RubyEntry",
    source: "class RubyEntry\nend\n",
  },
  {
    language: "php",
    file: "entry.php",
    symbol: "phpEntry",
    source: "<?php\nfunction phpEntry() {\n  return 1;\n}\n",
  },
  {
    language: "lua",
    file: "entry.lua",
    symbol: "luaEntry",
    source: "function luaEntry()\n  return 1\nend\n",
  },
  {
    language: "bash",
    file: "entry.sh",
    symbol: "bashEntry",
    source: "function bashEntry() {\n  return 0\n}\n",
  },
  {
    language: "dart",
    file: "entry.dart",
    symbol: "DartEntry",
    source: "class DartEntry {\n}\n",
  },
];

export const GraphFixtures = {
  GRAPH_EDGE_KINDS,
  GRAPH_NODE_KINDS,
  GRAPH_TRAVERSAL_EDGE_KINDS,
  GRAPH_REQUEST_TYPES,
  createClassifyFixture,
  createCmakeFixture,
  createContractFixture,
  createDualOwnerFixture,
  createTriviaFixture,
  createInheritanceFixture,
  createLspInheritanceFixture,
  createLspFixture,
  createOrderFixture,
  languageFixtures,
};
