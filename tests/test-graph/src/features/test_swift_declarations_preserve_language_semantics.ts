import { TestValidator } from "@nestia/e2e";

import { SwiftDeclarations } from "@samchon/graph-sitter";

export const test_swift_declarations_preserve_language_semantics = () => {
  const parse = SwiftDeclarations.parseSwiftDeclaration;

  TestValidator.equals(
    "property-wrapper attributes and public generic structs survive parsing",
    parse(
      "@propertyWrapper public struct Option<Value>: Decodable, ParsedWrapper {",
    ),
    {
      kind: "class",
      name: "Option",
      exported: true,
      modifiers: ["public"],
      decorators: ["propertyWrapper"],
    },
  );
  TestValidator.equals(
    "protocols and actors keep distinct declaration semantics",
    [
      parse("public protocol Parsable: Decodable {"),
      parse("package actor Loader: Sendable {"),
    ],
    [
      {
        kind: "interface",
        name: "Parsable",
        exported: true,
        modifiers: ["public", "abstract"],
      },
      { kind: "class", name: "Loader", modifiers: ["internal"] },
    ],
  );
  TestValidator.equals(
    "extensions name their canonical transparent nested owner",
    parse("public extension Math.Statistics: Sendable where Element: Numeric {"),
    {
      kind: "class",
      name: "Statistics",
      extensionOwner: "Math.Statistics",
      ownerNames: ["Math"],
      modifiers: ["public"],
    },
  );

  TestValidator.equals(
    "multiline generic async methods keep kind, operator name, and modifiers",
    [
      parse(
        "@MainActor public static func parse<T>(_ input: T) async throws -> T where T: Parsable {",
        "Parser",
        "class",
      ),
      parse(
        "public static func < (lhs: Self, rhs: Self) -> Bool {",
        "Parser",
        "class",
      ),
    ],
    [
      {
        kind: "method",
        name: "parse",
        modifiers: ["public", "static", "async"],
        decorators: ["MainActor"],
      },
      {
        kind: "method",
        name: "<",
        modifiers: ["public", "static"],
      },
    ],
  );
  TestValidator.equals(
    "constructors, deinitializers, subscripts, and operator declarations survive",
    [
      parse("public convenience init?<T>(_ value: T) {", "Box", "class"),
      parse("deinit {", "Box", "class"),
      parse("public subscript(index: Int) -> Element {", "Box", "class"),
      parse("infix operator <=>: ComparisonPrecedence"),
    ],
    [
      { kind: "constructor", name: "init", modifiers: ["public"] },
      { kind: "method", name: "deinit", modifiers: ["internal"] },
      { kind: "method", name: "subscript", modifiers: ["public"] },
      { kind: "function", name: "<=>", modifiers: ["internal"] },
    ],
  );

  TestValidator.equals(
    "properties preserve wrapper and access facts without indexing locals",
    [
      parse(
        "@Option public private(set) var value: String",
        "Command",
        "class",
      ),
      parse("private static let cache: [String: Value]", "Store", "class"),
      parse("let arg = ArgumentDefinition()", "parse", "method"),
    ],
    [
      {
        kind: "property",
        name: "value",
        modifiers: ["public"],
        decorators: ["Option"],
      },
      {
        kind: "property",
        name: "cache",
        modifiers: ["private", "static", "readonly"],
      },
      undefined,
    ],
  );
  TestValidator.equals(
    "enum cases preserve every case name without parsing switch cases",
    SwiftDeclarations.swiftEnumCaseNames(
      "case value(Value), definition((InputKey) -> ArgumentSet), `default`",
    ),
    ["value", "definition", "default"],
  );
  TestValidator.equals(
    "associated types remain type declarations owned by their protocol",
    parse("associatedtype Value: Sendable", "Parsed", "interface"),
    {
      kind: "type",
      name: "Value",
      modifiers: ["internal", "abstract"],
    },
  );

  TestValidator.equals(
    "Swift inheritance and protocol-conformance relations stay distinct",
    [
      SwiftDeclarations.swiftInheritedTypes(
        "public class Child<T>: Base<T>, @unchecked Sendable where T: Hashable {",
      ),
      SwiftDeclarations.swiftInheritedTypes(
        "public protocol Child: Parent, Sendable {",
      ),
      SwiftDeclarations.swiftInheritanceRelation("class", "interface"),
      SwiftDeclarations.swiftInheritanceRelation("interface", "interface"),
    ],
    [
      ["Base", "Sendable"],
      ["Parent", "Sendable"],
      "implements",
      "extends",
    ],
  );
  TestValidator.equals(
    "declaration-scoped imports retain the imported name and module",
    SwiftDeclarations.parseSwiftImport(
      "@_implementationOnly import struct Foundation.URL",
    ),
    { name: "Foundation.URL", module: "Foundation" },
  );
  TestValidator.predicate(
    "parenthesized, generic, and trailing-closure calls are callable uses",
    SwiftDeclarations.isSwiftCallSuffix("parse(value)", 5) &&
      SwiftDeclarations.isSwiftCallSuffix("decode<Result>(value)", 6) &&
      SwiftDeclarations.isSwiftCallSuffix("withTaskGroup { group in", 13) &&
      !SwiftDeclarations.isSwiftCallSuffix("Parser.Type", 6),
  );

  const multiline = [
    "@available(",
    "  *, deprecated,",
    '  message: \"{ is attribute data }\"',
    ")",
    "public func parse<T>(",
    "  _ input: T",
    ") async throws -> T",
    "where T: ParsableArguments {",
    '  let raw = #\"{ is string data }\"#',
    "  /* { outer /* nested } */ still comment } */",
    "  return input",
    "}",
    "public func sibling() {}",
  ];
  const header = SwiftDeclarations.swiftDeclarationHeader(multiline, 4);
  TestValidator.predicate(
    "attributes and multiline generic constraints form one declaration head",
    header.includes("public func parse<T>(") &&
      header.includes("where T: ParsableArguments {") &&
      !header.includes("let raw"),
  );
  TestValidator.equals(
    "multiline attributes remain attached without becoming declarations",
    SwiftDeclarations.swiftDecoratorsAbove(multiline, 4),
    ["available"],
  );
  TestValidator.equals(
    "raw literals and nested comments cannot close a Swift declaration",
    SwiftDeclarations.swiftDeclarationEndIndex(multiline, 4),
    11,
  );
  TestValidator.equals(
    "a bodyless protocol requirement cannot consume the next method body",
    SwiftDeclarations.swiftDeclarationEndIndex(
      ["func validate() throws", "func run() {", "}"],
      0,
    ),
    0,
  );
  TestValidator.equals(
    "a declaration whose brace starts on the next line keeps its body",
    SwiftDeclarations.swiftDeclarationEndIndex(
      ["func run()", "{", "  work()", "}"],
      0,
    ),
    3,
  );
};
