import { TestValidator } from "@nestia/e2e";

import { PhpDeclarations } from "@samchon/graph-sitter";

/**
 * PHP writes its class members with implicit visibility, decorates them with
 * `#[Attr]`, and delimits namespaces against text that only looks like code.
 * A namespace scope that swallows a comment, string, or heredoc renames every
 * declaration the file owns.
 */
export const test_php_constants_attributes_and_masked_namespaces = () => {
  const parse = PhpDeclarations.parsePhpDeclaration;

  // A class constant is a field. PHP constants are public unless marked
  // otherwise, and they always carry `const`.
  TestValidator.equals(
    "a class constant is a const field with PHP's implicit public visibility",
    [
      parse("const MAX_RETRIES = 3;", "Pipeline", "class"),
      parse("private const SECRET = 'x';", "Pipeline", "class"),
      parse("final public const VERSION = 2;", "Pipeline", "class"),
    ],
    [
      { kind: "field", name: "MAX_RETRIES", modifiers: ["public", "const"] },
      { kind: "field", name: "SECRET", modifiers: ["private", "const"] },
      { kind: "field", name: "VERSION", modifiers: ["public", "const"] },
    ],
  );
  // A constant is only a member: outside a type there is no class constant to
  // find, and `const` at namespace level is not one of this parser's subjects.
  TestValidator.equals(
    "a constant outside a type is not a class field",
    parse("const MAX_RETRIES = 3;"),
    undefined,
  );

  // PHP 4's `var` is still legal and means public.
  TestValidator.equals(
    "a `var` property is public, and an explicit visibility wins over it",
    [
      parse("var $legacy;", "Pipeline", "class"),
      parse("private $modern;", "Pipeline", "class"),
    ],
    [
      { kind: "property", name: "legacy", modifiers: ["public"] },
      { kind: "property", name: "modern", modifiers: ["private"] },
    ],
  );

  // An `#[Attr]` prefix is metadata, not the declaration: reading it as the
  // head hides the class or method that follows it on the same line.
  TestValidator.equals(
    "a PHP 8 attribute does not hide the declaration it decorates",
    [
      parse('#[Route("/home")] public function home() {}', "Ctl", "class"),
      parse("#[Attr] #[Second] class Tagged {}"),
      parse('#[Attr("]")] class Bracketed {}'),
    ],
    [
      { kind: "method", name: "home", modifiers: ["public"] },
      { kind: "class", name: "Tagged", exported: true },
      { kind: "class", name: "Bracketed", exported: true },
    ],
  );

  // An enum is its own kind; a trait is an interface-shaped contributor.
  TestValidator.equals(
    "enums, traits, and interfaces keep distinct PHP declaration kinds",
    [
      parse('enum Status: string { case Ready = "r"; }'),
      parse("trait Greets {}"),
      parse("interface Handler {}"),
    ],
    [
      { kind: "enum", name: "Status", exported: true },
      { kind: "interface", name: "Greets", exported: true },
      { kind: "interface", name: "Handler", exported: true },
    ],
  );

  const scopeNames = (source: string): (string | undefined)[] =>
    PhpDeclarations.indexPhpNamespaces(source).scopes.map((s) => s.name);

  // Every one of these hides the word `namespace` inside non-code. A scope
  // built from any of them would re-own the file under a fictional name.
  TestValidator.equals(
    "comments, strings, and heredocs never declare a namespace",
    [
      scopeNames("<?php\n# namespace HashTrap;\nnamespace Real;\n"),
      scopeNames("<?php\n// namespace LineTrap;\nnamespace Real;\n"),
      scopeNames("<?php\n/* namespace BlockTrap; */\nnamespace Real;\n"),
      scopeNames('<?php\n$s = "a\\" namespace StringTrap;";\nnamespace Real;\n'),
      scopeNames("<?php\n$a = <<<BARE\nnamespace BareTrap;\nBARE;\nnamespace Real;\n"),
      scopeNames("<?php\n$b = <<<'SQ'\nnamespace NowdocTrap;\nSQ;\nnamespace Real;\n"),
      scopeNames('<?php\n$c = <<<"DQ"\nnamespace DoubleTrap;\nDQ;\nnamespace Real;\n'),
    ],
    [["Real"], ["Real"], ["Real"], ["Real"], ["Real"], ["Real"], ["Real"]],
  );
  // `#[` opens an attribute, not a `#` comment: treating it as a comment would
  // erase the rest of the line, including a real declaration.
  TestValidator.equals(
    "`#[` is an attribute, so the namespace on the next line survives",
    scopeNames("<?php\n#[Attr]\nnamespace Real;\n"),
    ["Real"],
  );

  // Unterminated non-code must consume the remainder rather than reopening it
  // as code: a stray namespace found after EOF would own nothing real.
  TestValidator.equals(
    "unterminated comments and heredocs mask the rest of the file",
    [
      scopeNames("<?php\n/* namespace BlockTrap;\n"),
      scopeNames("<?php\n$a = <<<TEXT\nnamespace HeredocTrap;\n"),
      // ... and the same run of non-code when the file ends without a newline.
      scopeNames("<?php\n$a = <<<TEXT\nnamespace HeredocTrap;"),
      scopeNames("<?php\nnamespace Real;\n// namespace LineTrap;"),
      scopeNames("<?php\nnamespace Real;\n# namespace HashTrap;"),
    ],
    [[], [], [], ["Real"], ["Real"]],
  );

  // A braced namespace whose `}` never arrives owns the rest of the source.
  const unterminated = "<?php\nnamespace Open {\n";
  TestValidator.equals(
    "an unclosed braced namespace extends to the end of the source",
    PhpDeclarations.indexPhpNamespaces(unterminated).scopes,
    [{ start: 22, end: unterminated.length, name: "Open" }],
  );

  // A declaration inside the scope resolves to it; a position past the last
  // line has no namespace rather than inheriting the last one.
  const index = PhpDeclarations.indexPhpNamespaces(
    "<?php\nnamespace Real;\nclass Box {}\n",
  );
  TestValidator.equals(
    "a position beyond the file resolves to no namespace",
    [
      PhpDeclarations.phpNamespaceAt(index, 2, 0),
      PhpDeclarations.phpNamespaceAt(index, 99, 0),
    ],
    ["Real", undefined],
  );
};
