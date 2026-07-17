import { TestValidator } from "@nestia/e2e";

import { SwiftDeclarations } from "@samchon/graph-sitter";

export const test_swift_top_level_and_enum_members_keep_their_own_kinds = () => {
  // The same Swift spelling means different things depending on what encloses
  // it. `func` at file scope is a free function, not a method; `let` at file
  // scope is a variable, not a property; and both are on the module's surface
  // when they are `public`, which a member never is on its own.
  TestValidator.equals(
    "a public top-level func and let are a function and a variable on the surface",
    [
      SwiftDeclarations.parseSwiftDeclaration(
        "public func parse(_ input: String) -> String {",
      ),
      SwiftDeclarations.parseSwiftDeclaration("public let shared = Store()"),
      SwiftDeclarations.parseSwiftDeclaration("var cursor = 0"),
    ],
    [
      { kind: "function", name: "parse", exported: true, modifiers: ["public"] },
      {
        kind: "variable",
        name: "shared",
        exported: true,
        modifiers: ["public", "readonly"],
      },
      { kind: "variable", name: "cursor", modifiers: ["internal"] },
    ],
  );

  // An `enum` is not a class, and its cases are the members it publishes. A
  // case has no `let`, no `var`, and no `func`, so the enum it sits in is the
  // only thing that makes `success` a member rather than a stray identifier.
  TestValidator.equals(
    "an enum is an enum, and its cases are its properties",
    [
      SwiftDeclarations.parseSwiftDeclaration("public enum Outcome<Value> {"),
      SwiftDeclarations.parseSwiftDeclaration(
        "case success(Value)",
        "Outcome",
        "enum",
      ),
      SwiftDeclarations.parseSwiftDeclaration("case success", "Outcome", "class"),
    ],
    [
      { kind: "enum", name: "Outcome", exported: true, modifiers: ["public"] },
      { kind: "property", name: "success", modifiers: ["internal"] },
      undefined,
    ],
  );
  TestValidator.equals(
    "a Swift declaration that is not a `case` names no enum cases",
    [
      SwiftDeclarations.swiftEnumCaseNames("let value = 1"),
      SwiftDeclarations.swiftEnumCaseNames(
        "case values([String]), pair((Int, Int)), plain",
      ),
    ],
    [[], ["values", "pair", "plain"]],
  );

  // An extension on a plain type adds to that type, with no dotted owner to
  // recover -- the transparent-owner rule has to answer both shapes.
  TestValidator.equals(
    "an extension on a top-level type names that type and owns nothing above it",
    SwiftDeclarations.parseSwiftDeclaration("extension Array {"),
    {
      kind: "class",
      name: "Array",
      extensionOwner: "Array",
      modifiers: ["internal"],
    },
  );

  // `swiftInheritedTypes` answers a head's conformance list. A head with no
  // list, and a head that is not a type at all, both inherit nothing -- and a
  // `where` clause full of tuples and array types must not be mistaken for one.
  TestValidator.equals(
    "a head with no conformance list, or no type at all, inherits nothing",
    [
      SwiftDeclarations.swiftInheritedTypes("func parse() -> String {"),
      SwiftDeclarations.swiftInheritedTypes("struct Plain {"),
      SwiftDeclarations.swiftInheritedTypes(
        "extension Array where Element == (Int, Int) {",
      ),
      SwiftDeclarations.swiftInheritedTypes(
        "extension Sequence where Element == [String] {",
      ),
    ],
    [[], [], [], []],
  );
  TestValidator.equals(
    "a line that is not an import declares no imported module",
    SwiftDeclarations.parseSwiftImport("let importantValue = 1"),
    undefined,
  );
};
