import { TestValidator } from "@nestia/e2e";

import { SwiftDeclarations } from "@samchon/graph-sitter";

export const test_swift_bodyless_heads_end_where_their_own_syntax_ends = () => {
  // A Swift head with no body of its own has to end at its own syntax: nothing
  // closes it. A stored property, a typealias, and an enum case are each
  // complete without a brace, so the head rule has to recognise them -- and it
  // has to keep reading while a trailing comma says the declaration continues.
  TestValidator.equals(
    "a bodyless property, typealias, or case head stops at its own end",
    [
      SwiftDeclarations.swiftDeclarationHeader(
        ["let name: String", "let age: Int"],
        0,
      ),
      SwiftDeclarations.swiftDeclarationHeader(
        ["typealias Row = [String: Value]", "func next() {}"],
        0,
      ),
      SwiftDeclarations.swiftDeclarationHeader(
        ["case first,", "     second", "case third"],
        0,
      ),
    ],
    ["let name: String", "typealias Row = [String: Value]", "case first, second"],
  );

  // Swift writes array and dictionary types with brackets, and `<` is both a
  // generic opener and the less-than operator. A head rule that counted either
  // wrong would take the body's `{` at the wrong depth.
  const brackets = [
    "func first(of values: [String]) -> [String: Int] {",
    "    return [:]",
    "}",
    "public static func < (lhs: Self, rhs: Self) -> Bool {",
    "    return true",
    "}",
  ];
  TestValidator.equals(
    "array types and a `<` operator name do not disturb the body boundary",
    [
      SwiftDeclarations.swiftDeclarationHeader(brackets, 0),
      SwiftDeclarations.swiftDeclarationEndIndex(brackets, 0),
      SwiftDeclarations.swiftDeclarationHeader(brackets, 3),
      SwiftDeclarations.swiftDeclarationEndIndex(brackets, 3),
    ],
    [
      "func first(of values: [String]) -> [String: Int] {",
      2,
      "public static func < (lhs: Self, rhs: Self) -> Bool {",
      5,
    ],
  );

  // The occurrence scanner asks whether an identifier is being called. Swift
  // spells a call with parentheses, with a trailing closure, or with explicit
  // generic arguments before either -- and a bare type reference with none.
  TestValidator.predicate(
    "a generic name followed by a trailing closure is a call, unclosed is not",
    SwiftDeclarations.isSwiftCallSuffix("withTaskGroup<Void> { group in", 13) &&
      !SwiftDeclarations.isSwiftCallSuffix("decode<Result", 6) &&
      !SwiftDeclarations.isSwiftCallSuffix("Parser<Int>.self", 6),
  );

  // Swift's `<` is significant only when it opens generic arguments, which it
  // does when it hugs the name before it -- whatever whitespace follows inside
  // the list. A head truncated at the `<` opens nothing at all.
  TestValidator.equals(
    "whitespace inside a generic list does not stop it from being one",
    [
      SwiftDeclarations.swiftDeclarationHeader(
        ["func parse< T >(_ input: T) -> T {", "}"],
        0,
      ),
      SwiftDeclarations.swiftDeclarationHeader(["func parse<"], 0),
    ],
    ["func parse< T >(_ input: T) -> T {", "func parse<"],
  );

  // Neither an ordinary statement nor an unterminated head is a declaration the
  // scan may bound past its own line: the file may be mid-edit and there is no
  // compiler in this lane to say so.
  TestValidator.equals(
    "a statement is no head, and an unterminated head bounds itself",
    [
      SwiftDeclarations.swiftDeclarationHeader(["cursor = index + 1"], 0),
      SwiftDeclarations.swiftDeclarationHeader(["public func parse("], 0),
      SwiftDeclarations.swiftDeclarationEndIndex(["public func parse("], 0),
      SwiftDeclarations.swiftDeclarationHeader(["public func parse() {}"], 0),
      SwiftDeclarations.swiftDeclarationEndIndex(
        ["public struct Box {", "    let value: Int"],
        0,
      ),
    ],
    [
      "cursor = index + 1",
      "public func parse(",
      0,
      "public func parse() {}",
      0,
    ],
  );
};
