const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

exports.GRAPH_NODE_KINDS = [
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

exports.GRAPH_EDGE_KINDS = [
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
  "decorates",
  "renders",
  "tests",
  "references",
];

exports.GRAPH_REQUEST_TYPES = [
  "entrypoints",
  "lookup",
  "trace",
  "details",
  "overview",
  "tour",
  "escape",
];

exports.createOrderFixture = () => {
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

exports.createLspFixture = () => {
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
      "export function helper(): void {",
      "  return;",
      "}",
    ].join("\n"),
  );
  return root;
};

exports.createContractFixture = () => {
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
      decorators: [{ name: "Route", arguments: ["/run"], evidence: evidence(6, "@Route('/run')") }],
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
    generatedAt: new Date(0).toISOString(),
    indexer: "static",
    nodes,
    edges: [
      edge(file, "external:typescript:ExternalApi", "imports", 1),
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
        message: "contract warning",
        severity: "warning",
        source: "fixture",
        code: "C001",
        evidence: evidence(13, "const settings = {}"),
      },
    ],
    warnings: [],
  };
  return { root, dump };
};

exports.languageFixtures = [
  {
    language: "typescript",
    file: "entry.ts",
    symbol: "TypeScriptEntry",
    source: "export function TypeScriptEntry() { return 1; }\n",
  },
  {
    language: "javascript",
    file: "entry.js",
    symbol: "javascriptEntry",
    source: "export function javascriptEntry() { return 1; }\n",
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
];
