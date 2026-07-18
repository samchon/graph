import { TestValidator } from "@nestia/e2e";

import { SwiftDeclarations } from "@samchon/graph-sitter";

export const test_swift_attributes_are_erased_down_to_what_they_annotate = () => {
  // A Swift attribute is metadata about a declaration, never a declaration. It
  // may carry a parenthesised argument list, a dotted module-qualified name, or
  // nothing at all, and it may be the only thing on its line. Each spelling has
  // to be recognised, recorded as a decorator, and then erased -- otherwise the
  // declaration under it is read starting from the `@`.
  TestValidator.equals(
    "an attribute with arguments is recorded and erased, leaving its declaration",
    SwiftDeclarations.parseSwiftDeclaration(
      '@available(*, deprecated, message: "use parse") public func legacy() {',
    ),
    {
      kind: "function",
      name: "legacy",
      exported: true,
      modifiers: ["public"],
      decorators: ["available"],
    },
  );
  TestValidator.equals(
    "a module-qualified attribute keeps its dotted spelling",
    SwiftDeclarations.parseSwiftDeclaration(
      "@MyModule.Wrapper struct Box {",
    ),
    {
      kind: "class",
      name: "Box",
      modifiers: ["internal"],
      decorators: ["MyModule.Wrapper"],
    },
  );
  TestValidator.equals(
    "a line that is only an attribute declares nothing and heads nothing",
    [
      SwiftDeclarations.parseSwiftDeclaration("@Marker"),
      SwiftDeclarations.parseSwiftDeclaration("@available("),
      SwiftDeclarations.parseSwiftDeclaration("@"),
      SwiftDeclarations.swiftDecoratorNames("@Marker"),
      SwiftDeclarations.swiftDeclarationHeader(
        ["@available(*, deprecated)", "public func legacy() {}"],
        0,
      ),
    ],
    [undefined, undefined, undefined, ["Marker"], "@available(*, deprecated)"],
  );

  // `optional` is a protocol requirement's own fact, and Swift spells it two
  // ways: on its own after `@objc`, and inside an `@objc optional` head.
  TestValidator.equals(
    "an `@objc optional` protocol requirement carries the optional fact",
    SwiftDeclarations.parseSwiftDeclaration(
      "@objc optional func didLoad()",
      "Delegate",
      "interface",
    ),
    {
      kind: "method",
      name: "didLoad",
      modifiers: ["internal", "abstract", "optional"],
      decorators: ["objc"],
    },
  );

  // Attributes stack above the declaration they annotate, indented with it, and
  // the search upward has to walk past the ordinary code above them.
  const lines = [
    "import Foundation",
    "",
    "struct Box {",
    "    @MainActor @Sendable",
    "    func run() {}",
    "}",
  ];
  TestValidator.equals(
    "stacked attributes above an indented declaration are found and attached",
    [
      SwiftDeclarations.swiftDecoratorsAbove(lines, 4),
      SwiftDeclarations.swiftDecoratorsAbove(lines, 2),
      SwiftDeclarations.swiftDecoratorsAbove(["func run() {}"], 0),
    ],
    [["MainActor", "Sendable"], [], []],
  );
};
