import { TestValidator } from "@nestia/e2e";

import { SwiftDeclarations } from "@samchon/graph-sitter";

export const test_swift_literals_and_comments_cannot_open_a_declaration_body = () => {
  // Swift has more ways to write a brace that is not a brace than any other
  // language the graph indexes: line comments, nested block comments, multiline
  // strings, escaped quotes, raw literals, and regex literals -- and a regex
  // literal starts with the same `/` a comment does. Every one of them can
  // carry a `{` or a `}`, and the declaration bounding rules count braces.
  const lines = [
    "func render(model: Model) -> String {",
    "    // if model.ready { return }",
    "    /* outer /* nested } */ still comment } */",
    '    let quoted = "she said \\"} { \\""',
    '    let raw = #"a raw } brace"#',
    "    let block = \"\"\"",
    "    a multiline } brace",
    '    """',
    "    let digits = /[}{a-z]+/",
    "    let escaped = /a\\/}b/",
    "    let hashed = #/[}{]+/#",
    "    return quoted + raw + block",
    "}",
    "func sibling() {}",
  ];
  TestValidator.equals(
    "no Swift comment, string, raw, or regex literal closes the body it sits in",
    [
      SwiftDeclarations.swiftDeclarationEndIndex(lines, 0),
      SwiftDeclarations.swiftDeclarationEndIndex(lines, 13),
    ],
    [12, 13],
  );

  // `#` opens a raw literal only when a quote or slash follows it. Swift's
  // compile-time directives and expressions start with `#` too, and treating
  // `#if` as an unterminated raw string would mask the rest of the file.
  TestValidator.equals(
    "a `#` directive is not a raw literal, so the code after it stays code",
    SwiftDeclarations.swiftDeclarationEndIndex(
      [
        "func platform() -> String {",
        "    #if DEBUG",
        '    return "debug"',
        "    #else",
        '    return "release"',
        "    #endif",
        "}",
        "func after() {}",
      ],
      0,
    ),
    6,
  );

  // A literal left open at the end of a file must end at the file, not run the
  // bounding walk past it. The static lane reads whatever is on disk.
  TestValidator.equals(
    "an unterminated comment, string, or regex ends with the file",
    [
      SwiftDeclarations.swiftDeclarationEndIndex(
        ["func run() {", "    /* never closed"],
        0,
      ),
      SwiftDeclarations.swiftDeclarationEndIndex(
        ["func run() {", '    let text = "never closed'],
        0,
      ),
      SwiftDeclarations.swiftDeclarationEndIndex(
        ["func run() {", '    let block = """', "    never closed"],
        0,
      ),
      SwiftDeclarations.swiftDeclarationEndIndex(
        ["func run() {", "    let pattern = /never closed"],
        0,
      ),
      SwiftDeclarations.swiftDeclarationEndIndex(
        ["func run() {", "    // no newline closes this file"],
        0,
      ),
    ],
    [0, 0, 0, 0, 0],
  );
};
