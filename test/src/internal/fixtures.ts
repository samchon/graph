const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

exports.createOrderFixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "src", "service.ts"),
    [
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
  fs.writeFileSync(
    path.join(root, "src", "main.go"),
    [
      "package main",
      "type Repository struct{}",
      "func LoadOrder() string {",
      "  return FormatOrder()",
      "}",
      "func FormatOrder() string {",
      "  return \"ok\"",
      "}",
    ].join("\n"),
  );
  return root;
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
    source: "public class JavaEntry {\n}\n",
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
    source: "fun kotlinEntry(): Int {\n  return 1\n}\n",
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
    source: "def scalaEntry(): Int = 1\n",
  },
  {
    language: "zig",
    file: "entry.zig",
    symbol: "zigEntry",
    source: "pub fn zigEntry() i32 {\n  return 1;\n}\n",
  },
];
