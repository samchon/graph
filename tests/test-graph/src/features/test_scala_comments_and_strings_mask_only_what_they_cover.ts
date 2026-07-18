import { TestValidator } from "@nestia/e2e";

import { ScalaDeclarations } from "@samchon/graph-sitter";

export const test_scala_comments_and_strings_mask_only_what_they_cover = () => {
  // Scala nests block comments, so the first `*/` inside `/* /* */ */` closes
  // only the inner one. It also has line comments, escaped quotes, and triple
  // quotes -- and this parser reads indentation, so the mask has to give every
  // line back at its original length or an indentation scope moves.
  const lines = [
    "// class GhostFromLineComment",
    "/* outer /* class GhostFromNestedComment */ still comment */",
    "val escaped = \"she said \\\"class GhostFromEscapedString\\\"\"",
    "val prose = \"\"\"",
    "class GhostFromTripleQuote",
    "\"\"\"",
    "class Real",
  ];
  const masked = ScalaDeclarations.scalaLexicalLines(lines);

  TestValidator.equals(
    "masking gives every line back at its own length, so indentation survives",
    masked.map((line) => line.length),
    lines.map((line) => line.length),
  );
  TestValidator.predicate(
    "no comment or string content survives to be read as Scala",
    masked.every((line) => !line.includes("Ghost") && !line.includes("said")),
  );
  TestValidator.equals(
    "a nested comment's inner `*/` does not reopen the code after it",
    masked[1]!.trim(),
    "",
  );
  TestValidator.equals(
    "the declarations a file really writes are the declarations it keeps",
    [...ScalaDeclarations.scan(lines)].map(([index, declaration]) => [
      index,
      declaration.name,
      declaration.kind,
    ]),
    [
      [2, "escaped", "variable"],
      [3, "prose", "variable"],
      [6, "Real", "class"],
    ],
  );
};
