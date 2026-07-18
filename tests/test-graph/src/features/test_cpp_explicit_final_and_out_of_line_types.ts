import fs from "node:fs";
import path from "node:path";

import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";
import { CppDeclarations } from "@samchon/graph-sitter";

import { GraphPaths } from "../internal/GraphPaths";

/**
 * Three C++ heads carry the declared identity in a place the parser used to
 * misread: an `explicit` constructor keeps the class name after a modifier, a
 * `final` class keeps its own name rather than the contextual keyword, and an
 * out-of-line nested definition names the member owned by a qualifier written
 * with `::`. Each must survive both the unit parse and the whole-file dump.
 */
export const test_cpp_explicit_final_and_out_of_line_types = async () => {
  const parse = CppDeclarations.parseCppDeclaration;

  // A single-argument `explicit` constructor is C++ house style. The modifier
  // sits in front of the class name, so recognising the constructor must not
  // depend on trailing whitespace that a trimmed head never carries.
  TestValidator.equals(
    "an explicit constructor is a constructor, not a method named after the class",
    [
      parse("explicit Engine(int key);", "Engine", "class"),
      parse("inline explicit Engine(int key);", "Engine", "class"),
      parse("Engine();", "Engine", "class"),
    ],
    [
      { kind: "constructor", name: "Engine" },
      { kind: "constructor", name: "Engine" },
      { kind: "constructor", name: "Engine" },
    ],
  );
  // A member that shares the class name but carries a real return type is a
  // method, not a constructor: `Status` is a type, not a modifier. This is the
  // negative twin that keeps the modifier check from swallowing return types.
  TestValidator.equals(
    "a same-named member with a return type stays a method, and a plain method stays a method",
    [
      parse("Status Engine(int key);", "Engine", "class"),
      parse("Status Get(int key);", "Engine", "class"),
    ],
    [
      { kind: "method", name: "Engine" },
      { kind: "method", name: "Get" },
    ],
  );
  // A lone modifier is not a declaration head at all: without a parameter list
  // there is nothing to index, so it must not be mistaken for a constructor.
  TestValidator.equals(
    "a bare modifier keyword is not indexed",
    parse("explicit", "Engine", "class"),
    undefined,
  );

  // `final` after a class name is a contextual keyword, never the type name.
  // A `final` written where the name belongs (immediately after the class-key)
  // is a legal identifier and must be preserved.
  TestValidator.equals(
    "a final class keeps its own name, and a class genuinely named final is preserved",
    [
      parse("struct Vec final { };"),
      parse("class Widget final : public Base {"),
      parse("struct Vec { };"),
      parse("struct final { };"),
    ],
    [
      { kind: "class", name: "Vec" },
      { kind: "class", name: "Widget" },
      { kind: "class", name: "Vec" },
      { kind: "class", name: "final" },
    ],
  );

  // `A::B` is a qualified name, not a base-class list. The `::` must never be
  // split at the colon, so an out-of-line nested definition keeps its owner.
  TestValidator.equals(
    "an out-of-line nested type is owned by its qualifier, and a base list is not an owner",
    [
      parse("class Outer::Inner { };"),
      parse("struct A::B::C { };"),
      parse("class Outer::Inner : public Base {"),
      parse("class Derived : public Base {"),
      parse("class Derived:public Base{"),
      parse("class Inner {"),
    ],
    [
      { kind: "class", name: "Inner", ownerNames: ["Outer"] },
      { kind: "class", name: "C", ownerNames: ["A", "B"] },
      { kind: "class", name: "Inner", ownerNames: ["Outer"] },
      { kind: "class", name: "Derived" },
      { kind: "class", name: "Derived" },
      { kind: "class", name: "Inner" },
    ],
  );

  const root = GraphPaths.createTempDirectory("samchon-cpp-static-heads-");
  fs.writeFileSync(
    path.join(root, "types.hpp"),
    [
      "namespace demo {",
      "struct Status {};",
      "class Engine {",
      " public:",
      "  explicit Engine(int key);",
      "  Status Get(int key);",
      "};",
      "struct Vec final {",
      "  int x;",
      "};",
      "class Outer {",
      "  int a;",
      "};",
      "class Outer::Inner {",
      "  int value;",
      "};",
      "}",
    ].join("\n"),
  );

  const graph = await buildGraphDump({
    cwd: root,
    mode: "static",
    languages: ["cpp"],
  });
  const node = (qualifiedName: string) =>
    graph.nodes.find((n) => (n.qualifiedName ?? n.name) === qualifiedName);

  TestValidator.equals(
    "the explicit constructor is indexed with the constructor kind",
    node("demo.Engine.Engine")?.kind,
    "constructor",
  );
  TestValidator.equals(
    "a real method is still a method",
    node("demo.Engine.Get")?.kind,
    "method",
  );
  TestValidator.predicate(
    "the final class is named after the type, never the keyword",
    node("demo.Vec")?.kind === "class" &&
      !graph.nodes.some((n) => n.name === "final"),
  );

  const outer = node("demo.Outer");
  const inner = node("demo.Outer.Inner");
  TestValidator.equals(
    "an out-of-line nested definition is a class named Inner owned by Outer",
    inner?.kind,
    "class",
  );
  TestValidator.equals(
    "the nested definition is not dropped and is not owned by a phantom",
    inner?.name,
    "Inner",
  );
  TestValidator.predicate(
    "the nested definition is contained by its qualifier",
    outer !== undefined &&
      inner !== undefined &&
      graph.edges.some(
        (edge) =>
          edge.kind === "contains" &&
          edge.from === outer.id &&
          edge.to === inner.id,
      ),
  );
};
