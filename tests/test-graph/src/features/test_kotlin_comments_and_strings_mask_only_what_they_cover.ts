import { TestValidator } from "@nestia/e2e";

import { KotlinDeclarations } from "@samchon/graph-sitter";

export const test_kotlin_comments_and_strings_mask_only_what_they_cover = () => {
  // Kotlin nests block comments, so `/*` inside a comment opens a second one
  // and the first `*/` closes only the inner: a depth-blind mask would end the
  // comment early and hand the prose after it to the scan. An escaped quote is
  // the same problem inside a string. The mask has to preserve every line and
  // column too, because the spans it feeds are the spans the graph reports.
  const lines = [
    "// fun ghostFromLineComment() {}",
    "/* outer /* fun ghostFromNestedComment() {} */ still comment {} */",
    'val quoted = "she said \\"fun ghostFromEscapedString() {}\\""',
    "class Real",
  ];
  const masked = KotlinDeclarations.kotlinLexicalLines(lines);

  TestValidator.equals(
    "masking preserves every line and every column",
    masked.map((line) => line.length),
    lines.map((line) => line.length),
  );
  TestValidator.predicate(
    "no comment or string content survives to be read as Kotlin",
    masked.every((line) => !line.includes("ghost") && !line.includes("said")),
  );
  TestValidator.equals(
    "a nested comment's inner `*/` does not reopen the code after it",
    masked[1]!.trim(),
    "",
  );
  TestValidator.equals(
    "code outside a masked span keeps its exact spelling",
    [masked[2]!.slice(0, 13), masked[3]],
    ["val quoted = ", "class Real"],
  );
  TestValidator.equals(
    "nothing a comment or string spelled becomes a declaration",
    masked.map((line) =>
      KotlinDeclarations.parseKotlinDeclaration(line.trim()),
    ),
    [
      undefined,
      undefined,
      { kind: "variable", name: "quoted", exported: true, modifiers: ["public"] },
      { kind: "class", name: "Real", exported: true, modifiers: ["public"] },
    ],
  );

  // Kotlin's backtick identifiers are how the JVM ecosystem writes readable
  // test names. The backticks are quoting, not part of the name a caller finds.
  TestValidator.equals(
    "a backtick-quoted Kotlin name is indexed without its quoting",
    [
      KotlinDeclarations.parseKotlinDeclaration(
        "fun `parses a trailing comma`() {",
      ),
      KotlinDeclarations.parseKotlinDeclaration("val `odd name`: Int = 1"),
    ],
    [
      {
        kind: "function",
        name: "parses a trailing comma",
        exported: true,
        modifiers: ["public"],
      },
      {
        kind: "variable",
        name: "odd name",
        exported: true,
        modifiers: ["public"],
      },
    ],
  );
};
