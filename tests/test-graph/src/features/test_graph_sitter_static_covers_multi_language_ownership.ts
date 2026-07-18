import { TestValidator } from "@nestia/e2e";

import { graphSitterParts } from "@samchon/graph-sitter";
import type { GraphSitterLanguage } from "@samchon/graph-sitter";

interface Fixture {
  path: string;
  language: GraphSitterLanguage;
  source: string;
}

const parts = (...fixtures: readonly Fixture[]) =>
  graphSitterParts({
    root: "/project",
    files: fixtures.map((fixture) => ({
      absolutePath: `/project/${fixture.path}`,
      relativePath: fixture.path,
      language: fixture.language,
      source: fixture.source,
    })),
  });

const names = (result: ReturnType<typeof parts>): string[] =>
  result.nodes.map((node) => node.qualifiedName ?? node.name).sort();

/**
 * The graph adapter delegates all static parsing to `graphSitterParts`, and a
 * set of its multi-language ownership rules have no fixture in the language
 * suites: a Swift `extension` transparent owner and its imports, a PHP namespace
 * that closes the one before it, C++ out-of-line and cross-file owners, a Rust
 * generic `impl` receiver, the Java member reader's rejections, a C control-flow
 * head, and the generic keyword parser for scanner-less languages.
 */
export const test_graph_sitter_static_covers_multi_language_ownership = () => {
  // A Swift `extension` names no type: it adds members to one declared here,
  // elsewhere, or in another module. It becomes a transparent owner, so its
  // members answer to the extended type whether or not the type is in this file.
  const swift = names(
    parts({
      path: "box.swift",
      language: "swift",
      source: [
        "import Foundation",
        "import struct Foundation.URL",
        "struct Box {",
        "    let value: Int",
        "}",
        "extension Box {",
        "    func doubled() -> Int { return value * 2 }",
        "}",
        "extension Array {",
        "    func secondOr(_ fallback: Element) -> Element { return fallback }",
        "}",
      ].join("\n"),
    }),
  );
  TestValidator.equals(
    "a Swift extension attaches its members to the extended type",
    [swift.includes("Box.doubled"), swift.includes("Array.secondOr")],
    [true, true],
  );

  // Two PHP namespaces in one file: the second must close the first so its class
  // is not buried under a namespace that already ended.
  const php = names(
    parts({
      path: "app.php",
      language: "php",
      source: [
        "<?php",
        "namespace App\\First;",
        "class Alpha {}",
        "namespace App\\Second;",
        "class Beta {}",
      ].join("\n"),
    }),
  );
  TestValidator.equals(
    "a second PHP namespace closes the first",
    php,
    ["App.First", "App.First.Alpha", "App.Second", "App.Second.Beta"],
  );

  // A C++ member defined out of line names its owner in the head. Within the
  // file the owner resolves directly; across files the project-wide pass links
  // the definition to the type declared elsewhere, preferring the type with a
  // body over a forward declaration.
  const cpp = names(
    parts(
      {
        path: "shape.hpp",
        language: "cpp",
        source: [
          "namespace ns {",
          "class Shape {",
          "  void draw();",
          "};",
          "}",
        ].join("\n"),
      },
      {
        path: "shape.cpp",
        language: "cpp",
        source: ["class Shape;", "void ns::Shape::draw() {}"].join("\n"),
      },
      {
        path: "widget.cpp",
        language: "cpp",
        source: [
          "class Widget {",
          "  void paint();",
          "};",
          "void Widget::paint() {}",
        ].join("\n"),
      },
    ),
  );
  TestValidator.predicate(
    "C++ out-of-line and cross-file members find their owners",
    cpp.includes("ns.Shape.draw") && cpp.includes("Widget.paint"),
  );

  // A Rust generic `impl` writes the receiver with its type parameters; the impl
  // owner rule strips them so the method answers to the bare type.
  const rust = names(
    parts({
      path: "grid.rs",
      language: "rust",
      source: [
        "struct Grid<T> {",
        "    cells: Vec<T>,",
        "}",
        "impl<T> Grid<T> {",
        "    pub fn size(&self) -> usize { 0 }",
        "}",
      ].join("\n"),
    }),
  );
  TestValidator.predicate(
    "a Rust generic impl attaches its method to the bare type",
    rust.includes("Grid.size"),
  );

  // A C source file: a control-flow head is not a function, a `static` function
  // is file-local, and a bare function is exported.
  const c = names(
    parts({
      path: "run.c",
      language: "c",
      source: [
        "int run(int ready) {",
        "    if (ready) {",
        "        return 1;",
        "    }",
        "    return 0;",
        "}",
        "static int helper(int a)",
        "{",
        "    return a;",
        "}",
      ].join("\n"),
    }),
  );
  TestValidator.equals(
    "a C control-flow head is no function while real functions survive",
    c,
    ["helper", "run"],
  );

  // A clean Java class keeps its real members while an initialised field is not
  // mistaken for a method (its head carries an `=`).
  const java = names(
    parts({
      path: "Service.java",
      language: "java",
      source: [
        "class Service {",
        "    int cached = compute();",
        "    void ready() throws IllegalStateException {}",
        "    void plain() {}",
        "}",
      ].join("\n"),
    }),
  );
  TestValidator.equals(
    "the Java reader keeps real methods and drops an initialised field",
    [
      java.includes("Service.ready"),
      java.includes("Service.plain"),
      java.includes("Service.cached"),
    ],
    [true, true, false],
  );

  // A mid-edit Java class carries heads no compiler would accept: a parameter
  // list left unclosed and a head whose tail is an assignment rather than a body
  // or `throws`. Neither becomes a phantom method.
  const javaTruncated = names(
    parts({
      path: "Draft.java",
      language: "java",
      source: [
        "class Draft {",
        "    void truncated(int value",
        "    int broken() = 5",
        "}",
      ].join("\n"),
    }),
  );
  TestValidator.equals(
    "a truncated head and an assignment tail are no Java methods",
    [
      javaTruncated.includes("Draft.truncated"),
      javaTruncated.includes("Draft.broken"),
    ],
    [false, false],
  );

  // The generic keyword parser maps a `def`/`func` token onto a callable kind
  // for the languages without a dedicated scanner.
  const generic = names(
    parts(
      {
        path: "mod.py",
        language: "python",
        source: ["def compute():", "    return 1", "class Model:", "    pass"].join(
          "\n",
        ),
      },
      {
        path: "mod.go",
        language: "go",
        source: ["package mod", "func Compute() int {", "    return 1", "}"].join(
          "\n",
        ),
      },
    ),
  );
  TestValidator.predicate(
    "the generic parser recovers callables across scanner-less languages",
    generic.includes("compute") && generic.includes("Compute"),
  );
};
