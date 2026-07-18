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

  // The Java member reader survives mid-edit and off-shape heads: a parameter
  // list left unclosed at the end of the file, a head whose tail is a stray word
  // rather than a body or `throws`, and an annotation written with a space before
  // its arguments. None of the malformed heads becomes a phantom method, and the
  // annotated head is still read.
  const javaEof = names(
    parts({
      path: "Eof.java",
      language: "java",
      source: [
        "class Eof {",
        "    int dangling(int value",
        "    void real() {}",
        "}",
      ].join("\n"),
    }),
  );
  const javaTail = names(
    parts({
      path: "Tail.java",
      language: "java",
      source: [
        "class Tail {",
        "    int strayTail() nonsense",
        "    void real() {}",
        "}",
      ].join("\n"),
    }),
  );
  const javaAnnotated = names(
    parts({
      path: "Anno.java",
      language: "java",
      source: [
        "class Anno {",
        "    @Deprecated (\"legacy\")",
        "    void tagged() {}",
        "}",
      ].join("\n"),
    }),
  );
  TestValidator.equals(
    "the Java reader drops malformed heads and keeps the annotated method",
    [
      javaEof.includes("Eof.dangling"),
      javaTail.includes("Tail.strayTail"),
      javaTail.includes("Tail.real"),
      javaAnnotated.includes("Anno.tagged"),
    ],
    [false, false, true, true],
  );

  // A C++ definition whose owner type is declared nowhere in the project finds
  // no owner to attach to and is left as a free declaration rather than guessed.
  const cppOrphan = names(
    parts({
      path: "orphan.cpp",
      language: "cpp",
      source: ["void Nowhere::lost() {}"].join("\n"),
    }),
  );
  TestValidator.predicate(
    "a C++ member of an undeclared owner attaches to nothing",
    cppOrphan.some((name) => name.endsWith("lost")),
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

  // A `func` token in a scanner-less language still maps to a callable kind
  // through the generic keyword parser.
  const funcToken = names(
    parts({
      path: "gen.dart",
      language: "dart",
      source: ["func handler() {}"].join("\n"),
    }),
  );
  TestValidator.predicate(
    "a generic `func` token is read as a callable",
    funcToken.includes("handler"),
  );

  // A control keyword is not a C function name: a head shaped like a definition
  // but named for a control word declares nothing.
  const cControl = names(
    parts({
      path: "ctl.c",
      language: "c",
      source: ["int if(int x)", "{", "    return x;", "}"].join("\n"),
    }),
  );
  TestValidator.equals("a C control keyword names no function", cControl, []);

  // The Java member reader rejects a head with no name before its parameters and
  // a head whose return type is malformed, while keeping the real method beside
  // them.
  const javaOffshape = names(
    parts({
      path: "Odd.java",
      language: "java",
      source: [
        "class Odd {",
        "    int[] () {}",
        "    a.<b>c() {}",
        "    void real() {}",
        "}",
      ].join("\n"),
    }),
  );
  TestValidator.equals(
    "malformed Java heads are dropped while the real method survives",
    [javaOffshape.includes("Odd.real"), javaOffshape.length],
    [true, 2],
  );

  // A Lua owner written in the head (`function M.draw()`) may name a table whose
  // own declaration already closed above it; the owner lookup finds no enclosing
  // declaration and the member keeps its written owner.
  const luaScope = names(
    parts({
      path: "scope.lua",
      language: "lua",
      source: ["M = {}", "function M.draw() end"].join("\n"),
    }),
  );
  TestValidator.predicate(
    "a Lua member names its head owner even when the table already closed",
    luaScope.some((name) => name.endsWith("draw")),
  );

  // A Lua owner that IS a registered declaration but whose own range already
  // closed. `function M() end` registers `M` and bounds it to its single line,
  // then `function M.draw()` names owner `M` a line later. The enclosing-owner
  // lookup finds the registered `M` among its candidates yet every candidate
  // ends before the member, so the reverse scan falls through with no owner and
  // the member keeps its written owner — the case a bare table assignment (whose
  // owner is never registered at all) cannot reach.
  const luaClosedOwner = names(
    parts({
      path: "closed.lua",
      language: "lua",
      source: ["function M() end", "function M.draw() end"].join("\n"),
    }),
  );
  TestValidator.predicate(
    "a Lua member whose registered owner already closed keeps its written owner",
    luaClosedOwner.includes("M.draw"),
  );

  // The generic keyword parser maps a Rust `enum` token onto kind `enum`. Rust
  // flows through the keyword regex exactly as its `struct` does, so an `enum`
  // beside a `struct` proves the enum branch of the shared `kindOf`.
  const rustEnum = names(
    parts({
      path: "color.rs",
      language: "rust",
      source: ["enum Color {", "    Red,", "    Green,", "}"].join("\n"),
    }),
  );
  TestValidator.predicate(
    "a Rust enum token is read as an enum",
    rustEnum.includes("Color"),
  );

  // Two C++ types across the project share one un-namespaced qualified name, so
  // an out-of-line member that names that owner forces the cross-file owner
  // chooser to compare candidates that tie on the has-body term (both bodied)
  // and on the exported term (both unexported), exercising every tiebreaker down
  // to the stable id order. A bodyless forward declaration adds a third, unequal
  // candidate so the has-body term is exercised both ways.
  const cppDup = names(
    parts(
      {
        path: "dup_a.cpp",
        language: "cpp",
        source: ["class Dup {", "  void m();", "};"].join("\n"),
      },
      {
        path: "dup_b.cpp",
        language: "cpp",
        source: ["class Dup {", "  void n();", "};"].join("\n"),
      },
      {
        path: "dup_fwd.cpp",
        language: "cpp",
        source: ["class Dup;"].join("\n"),
      },
      {
        path: "dup_c.cpp",
        language: "cpp",
        source: ["void Dup::m() {}"].join("\n"),
      },
    ),
  );
  TestValidator.predicate(
    "an out-of-line C++ member resolves an owner shared across files",
    cppDup.includes("Dup.m") && cppDup.includes("Dup.n"),
  );

  // A Java method whose parameter list runs past the header reader's line cap.
  // The class body is bounded by the real brace/paren walk (which has no cap and
  // sees the list eventually close), so the method is offered to the member
  // reader as an in-container declaration; the capped header hands the reader an
  // unbalanced `(`, and the parenthesis matcher reports no close. The truncated
  // method is dropped while the well-formed method beside it survives.
  const javaLongParams = names(
    parts({
      path: "Big.java",
      language: "java",
      source: [
        "class Big {",
        "    void huge(",
        ...Array.from({ length: 40 }, (_, index) => `        int a${index},`),
        "        int last",
        "    ) {}",
        "    void real() {}",
        "}",
      ].join("\n"),
    }),
  );
  TestValidator.equals(
    "a Java method past the header line cap is dropped while the real one survives",
    [
      javaLongParams.includes("Big.real"),
      javaLongParams.some((name) => name.endsWith("huge")),
    ],
    [true, false],
  );

  // A Java member whose tail is an annotation-style `default` value. The member
  // reader accepts a `Type name() default value;` element tail (the shape a Java
  // annotation writes for an element's default) alongside the plain `{`, `;`,
  // and `throws` tails, so the element is kept as a member of its container.
  const javaDefaultTail = names(
    parts({
      path: "Config.java",
      language: "java",
      source: [
        "interface Config {",
        "    int count() default 5;",
        "    void real() {}",
        "}",
      ].join("\n"),
    }),
  );
  TestValidator.predicate(
    "the Java reader accepts a default-value element tail",
    javaDefaultTail.includes("Config.count"),
  );
};
