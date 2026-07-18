import { TestValidator } from "@nestia/e2e";

import {
  ISamchonGraphNode,
  staticDependencyEdges,
} from "@samchon/graph-sitter";
import type { GraphLanguage } from "@samchon/graph-sitter";

const node = (name: string, language: GraphLanguage): ISamchonGraphNode => ({
  id: name,
  kind: "function",
  name,
  language,
  file: "unit.src",
  external: false,
});

// Every fixture calls `real()` in code and hides a `ghost()` inside a literal or
// comment. Masking must blank the literal so only `real` resolves; a leaked
// `ghost` edge would prove the literal was read as code.
const masked = (language: GraphLanguage, body: string): string[] =>
  staticDependencyEdges(
    node("caller", language),
    body,
    new Map([
      ["real", [node("real", language)]],
      ["ghost", [node("ghost", language)]],
    ]),
  ).map((edge) => `${edge.kind}:${edge.to}`);

/**
 * `staticDependencyEdges` masks each language's string, comment, and literal
 * forms before reading occurrences. These forms have no fixture in the language
 * suites: a PHP attribute (not a comment) and heredoc-shaped shift, Python and
 * Scala string prefixes, a Rust escaped character literal, Ruby block comments,
 * data sections, percent and regex literals, and a flagged regex.
 */
export const test_static_dependency_masking_ignores_language_literals = () => {
  TestValidator.equals(
    "a PHP `#[` attribute is not a comment, so the call after it stays code",
    masked("php", "#[Attr] real();"),
    ["calls:real"],
  );
  TestValidator.equals(
    "a PHP `<<` shift is not a heredoc",
    masked("php", "real(); x = a << b;"),
    ["calls:real"],
  );
  TestValidator.equals(
    "a Python raw string hides the call spelled inside it",
    masked("python", 'real(); note = r"ghost()"'),
    ["calls:real"],
  );
  TestValidator.equals(
    "a Scala interpolated string hides the call spelled inside it",
    masked("scala", 'real(); msg = s"ghost()"'),
    ["calls:real"],
  );
  TestValidator.equals(
    "a Rust escaped character literal does not swallow the following code",
    masked("rust", "let c = '\\n'; real();"),
    ["calls:real"],
  );
  TestValidator.equals(
    "a Ruby block comment hides the call spelled inside it",
    masked("ruby", "real()\n=begin\nghost()\n=end"),
    ["calls:real"],
  );
  TestValidator.equals(
    "a Ruby data section masks everything after it",
    masked("ruby", "real()\n__END__\nghost()"),
    ["calls:real"],
  );
  TestValidator.equals(
    "a Ruby `%` modulo is not a percent literal",
    masked("ruby", "real(); x = a % b"),
    ["calls:real"],
  );
  TestValidator.equals(
    "a Ruby regex after a bare word hides the call spelled inside it",
    masked("ruby", "real(); scan /ghost()/"),
    ["calls:real"],
  );
  TestValidator.equals(
    "a flagged regex literal hides the call spelled inside it",
    masked("typescript", "real(); const re = /ghost()/gi;"),
    ["calls:real"],
  );
};
