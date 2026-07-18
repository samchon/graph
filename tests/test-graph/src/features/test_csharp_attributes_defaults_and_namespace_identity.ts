import { TestValidator } from "@nestia/e2e";

import { CsharpDeclarations } from "@samchon/graph-sitter";

/**
 * C# hides its declaration behind `[Attribute]` prefixes, leaves access
 * modifiers implicit, and lets `csharp-ls` report a namespace by its final
 * segment only. Each of those has one correct reading, and getting it wrong
 * renames or re-owns the declaration rather than merely losing it.
 */
export const test_csharp_attributes_defaults_and_namespace_identity = () => {
  const parse = CsharpDeclarations.parseCSharpDeclaration;

  // An attribute is metadata. Reading it as the head loses the declaration.
  TestValidator.equals(
    "attributes never hide the declaration they decorate",
    [
      parse("[Obsolete] public class Tagged {}"),
      parse('[Obsolete("use Run2")] [Browsable(false)] public void Run() {}', "Svc", "class"),
    ],
    [
      { kind: "class", name: "Tagged", modifiers: ["public"], exported: true },
      { kind: "method", name: "Run", modifiers: ["public"] },
    ],
  );

  // C# defaults: a namespace-level type is `internal`, and an unmarked class
  // member is `private`. Neither is written in the source.
  TestValidator.equals(
    "a namespace-level type without an access modifier is internal",
    [parse("class Bare {}"), parse("interface IBare {}"), parse("enum Level { Low }")],
    [
      { kind: "class", name: "Bare", modifiers: ["internal"] },
      { kind: "interface", name: "IBare", modifiers: ["internal"] },
      { kind: "enum", name: "Level", modifiers: ["internal"] },
    ],
  );
  TestValidator.equals(
    "an internal type is not part of the published surface, a public one is",
    [
      CsharpDeclarations.isCSharpPublishedType("class", [], ["internal"]),
      CsharpDeclarations.isCSharpPublishedType("class", [], ["public"]),
      CsharpDeclarations.isCSharpPublishedType("class", ["class"], ["public"]),
    ],
    [false, true, false],
  );

  // `struct` and `record` are class-shaped; `enum` keeps its own kind.
  TestValidator.equals(
    "structs, records, enums, and delegates keep their declaration kinds",
    [
      parse("public struct Point { }"),
      parse("public record struct Coord(int X);"),
      parse("public enum Level { Low }"),
      parse("public delegate void Routed(int id);"),
    ],
    [
      { kind: "class", name: "Point", modifiers: ["public"], exported: true },
      { kind: "class", name: "Coord", modifiers: ["public"], exported: true },
      { kind: "enum", name: "Level", modifiers: ["public"], exported: true },
      { kind: "type", name: "Routed", modifiers: ["public"], exported: true },
    ],
  );

  // A comment-only line carries no declaration, and neither do statements that
  // merely resemble one. `delegate { ... }` is an anonymous method expression,
  // not a delegate *type*, so it declares nothing.
  TestValidator.equals(
    "comments, statements, and anonymous delegate expressions declare nothing",
    [
      parse("/* only a comment */", "Svc", "class"),
      parse("return value;", "Svc", "class"),
      parse("throw new InvalidOperationException();", "Svc", "class"),
      parse("delegate { count++; };", "Svc", "class"),
    ],
    [undefined, undefined, undefined, undefined],
  );

  // csharp-ls reports `namespace Demo.Core;` as the symbol `Core`. The full
  // path has to be recovered from the declaration line, and re-anchored under
  // whatever owners the server already reported, without repeating them.
  TestValidator.equals(
    "a shortened namespace symbol regains its full dotted path",
    [
      CsharpDeclarations.csharpDocumentIdentity("Core", [], "namespace", "namespace Demo.Core;"),
      CsharpDeclarations.csharpDocumentIdentity("Deep", ["Demo"], "namespace", "namespace Demo.Core.Deep;"),
    ],
    [
      { name: "Core", owners: ["Demo"] },
      { name: "Deep", owners: ["Demo", "Core"] },
    ],
  );
  TestValidator.equals(
    "a non-namespace symbol, and a namespace whose line has no path, are untouched",
    [
      CsharpDeclarations.csharpDocumentIdentity("Logger", ["Demo"], "class", "public class Logger {"),
      CsharpDeclarations.csharpDocumentIdentity("Core", ["Demo"], "namespace", "class Logger {"),
    ],
    [
      { name: "Logger", owners: ["Demo"] },
      { name: "Core", owners: ["Demo"] },
    ],
  );

  // Only a class deriving from an interface is `implements`; every other base
  // relation keeps the relation the caller already determined.
  TestValidator.equals(
    "only class-to-interface inheritance becomes implements",
    [
      CsharpDeclarations.csharpInheritanceRelation("class", "interface", "extends"),
      CsharpDeclarations.csharpInheritanceRelation("class", "class", "extends"),
      CsharpDeclarations.csharpInheritanceRelation("interface", "interface", "extends"),
    ],
    ["implements", "extends", "extends"],
  );

  // A head that is not a declaration start is handed back untouched, so the
  // joiner never reaches forward and reports the next line's declaration here.
  TestValidator.equals(
    "attribute, comment, and blank lines are never joined into a head",
    [
      CsharpDeclarations.csharpDeclarationHeader(["[Obsolete]", "public void Run() {}"], 0),
      CsharpDeclarations.csharpDeclarationHeader(["", "public void Run() {}"], 0),
      CsharpDeclarations.csharpDeclarationHeader(["// comment", "public void Run() {}"], 0),
      CsharpDeclarations.csharpDeclarationHeader(["/* block */", "public void Run() {}"], 0),
      CsharpDeclarations.csharpDeclarationHeader([" * doc", "public void Run() {}"], 0),
    ],
    ["[Obsolete]", "", "// comment", "/* block */", " * doc"],
  );
  // An expression-bodied member ends the head at `=>` even without `;` or `{`.
  TestValidator.equals(
    "a multi-line head stops at its own terminator, not the next declaration",
    [
      CsharpDeclarations.csharpDeclarationHeader(
        ["public void Run(", "    int id)", "{", "}", "public void Next() {}"],
        0,
      ),
      CsharpDeclarations.csharpDeclarationHeader(
        ["public int Value =>", "    1;", "public int Next => 2;"],
        0,
      ),
    ],
    ["public void Run( int id) {", "public int Value =>"],
  );
};
