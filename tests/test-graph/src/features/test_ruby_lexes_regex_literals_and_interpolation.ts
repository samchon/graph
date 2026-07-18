import { TestValidator } from "@nestia/e2e";

import { RubyDeclarations } from "@samchon/graph-sitter";

/**
 * Ruby's `/` is either a regular-expression delimiter or division, and `#{}`
 * may carry arbitrary Ruby. Both decisions are lexical: a regex body that is
 * read as code (or a division read as a regex) leaks whatever follows into the
 * scan, and a single stray `end` inside masked text detaches every later
 * method from its class.
 */
export const test_ruby_lexes_regex_literals_and_interpolation = () => {
  // `run` must own exactly its own body, and `after` must survive as a sibling
  // of `run` rather than being swallowed by a mis-lexed literal.
  const bounded = (fact: string, body: readonly string[]): void => {
    const lines = [
      "class Guard",
      "  def run(value, sep)",
      ...body,
      "  end",
      "",
      "  def after",
      "    :ok",
      "  end",
      "end",
    ];
    const declarations = RubyDeclarations.scan(lines);
    const afterIndex = body.length + 4;
    TestValidator.equals(fact, [...declarations.entries()], [
      [0, { kind: "class", name: "Guard", endIndex: lines.length - 1, exported: true, modifiers: ["public"] }],
      [1, { kind: "method", name: "run", endIndex: body.length + 2, exported: true, modifiers: ["public"] }],
      [afterIndex, { kind: "method", name: "after", endIndex: afterIndex + 2, exported: true, modifiers: ["public"] }],
    ]);
  };

  // Ruby's command-call form lets a regex follow a bare method name with no
  // parentheses. Every one of these bodies hides the word `end` inside the
  // regex, so a parser that stops masking early closes `run` on that line.
  bounded("an escaped slash does not end a command-call regex", [
    String.raw`    match /a\/end/`,
  ]);
  bounded("a character class does not end a command-call regex", [
    String.raw`    match /[/x]end/`,
  ]);
  bounded("an escaped bracket keeps a character class open", [
    String.raw`    match /[^\]]end/`,
  ]);
  bounded("interpolation inside a command-call regex stays masked", [
    String.raw`    match /a#{sep}end/`,
  ]);
  bounded("a quoted brace inside regex interpolation stays masked", [
    String.raw`    match /a#{ sep.fetch("}end") }b/`,
  ]);
  bounded("an escaped quote inside regex interpolation stays masked", [
    String.raw`    match /a#{ sep.fetch("\"/end") }b/`,
  ]);
  bounded("an escape in regex interpolation code stays masked", [
    String.raw`    match /a#{ sep =~ /\/end/ ? 1 : 2 }b/`,
  ]);
  bounded("a nested brace inside regex interpolation stays masked", [
    String.raw`    match /a#{ { k: "/end" }.size }b/`,
  ]);
  // A `#` comment inside the interpolation swallows the closing `/`, so the
  // slash never had a regex body: it is division, and the line's `end` is code.
  bounded("a comment inside regex interpolation leaves the slash as division", [
    String.raw`    value = sep /a#{ sep # end`,
    "    value",
  ]);

  // A slash that never closes on its line is division, not a regex: reading it
  // as a regex would mask the rest of the line and lose real code.
  bounded("a slash with no closing slash on the line is division", [
    "    half = value /2",
    "    half",
  ]);
  bounded("a tight `a/b` with no spaces is division", [
    "    value/sep",
  ]);
  bounded("a spaced `a / b` is division", [
    "    value / sep",
  ]);
  // A trailing `/` continues the expression onto the next line: there is no
  // regex body on this line at all, so nothing may be masked.
  bounded("a division whose slash ends the line is still division", [
    "    ratio = value /",
    "      sep",
    "    ratio",
  ]);

  // After a Ruby keyword the parser is in operand position, so `/` opens a
  // regex even though the same spacing would be division after a value.
  bounded("a regex directly after a keyword is a regex", [
    "    return /end/ if value",
  ]);

  // `#{}` may contain braces, nested strings, escapes, and comments. Each of
  // these hides `end` inside the interpolation of a string constant.
  bounded("a nested brace inside interpolation stays masked", [
    String.raw`    text = "#{ { a: 1 }.size } end"`,
    "    text",
  ]);
  bounded("a nested quoted string inside interpolation stays masked", [
    String.raw`    text = "#{ "q\"end" } end"`,
    "    text",
  ]);
  bounded("an escape inside interpolation code stays masked", [
    String.raw`    text = "#{ value =~ /\d/ ? 1 : 0 } end"`,
    "    text",
  ]);

  // A `#` inside `#{}` comments out the rest of the physical line, so the
  // interpolation — and the string — stay open onto the next line.
  const commented = RubyDeclarations.scan([
    "class Guard",
    String.raw`  TEXT = "#{ value # end of line`,
    String.raw`  } end"`,
    "  def after",
    "    :ok",
    "  end",
    "end",
  ]);
  TestValidator.equals(
    "a comment inside interpolation keeps the string open across lines",
    [...commented.entries()],
    [
      [0, { kind: "class", name: "Guard", endIndex: 6, exported: true, modifiers: ["public"] }],
      [3, { kind: "method", name: "after", endIndex: 5, exported: true, modifiers: ["public"] }],
    ],
  );
};
