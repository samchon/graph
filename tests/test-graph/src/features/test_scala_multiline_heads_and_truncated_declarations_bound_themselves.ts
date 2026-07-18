import { TestValidator } from "@nestia/e2e";

import { ScalaDeclarations } from "@samchon/graph-sitter";

export const test_scala_multiline_heads_and_truncated_declarations_bound_themselves = () => {
  // A Scala 3 head splits over type parameters, using clauses, and value
  // parameters, and the trailing comma Scala allows before `)` means the last
  // line of a parameter list looks like the middle of one. Reading only the
  // first line loses the return type the signature is for.
  const apply = [
    "def apply[A](",
    "  value: Long,",
    ")(using",
    "  ordering: Ordering[A],",
    "): UserId = value",
    "def after(): Unit = ()",
  ];
  TestValidator.equals(
    "a head split over type, using, and value parameters joins into one",
    ScalaDeclarations.scalaDeclarationHeader(apply, 0),
    "def apply[A]( value: Long, )(using ordering: Ordering[A], ): UserId = value",
  );

  // An annotation is metadata, and Scala writes it with or without arguments,
  // on the declaration's own line or the line above. Each spelling has to be
  // erased down to the declaration, never read as one.
  TestValidator.equals(
    "an annotation with or without arguments is erased down to its declaration",
    [
      ScalaDeclarations.parseScalaDeclaration("@main def Main(): Unit = ()"),
      ScalaDeclarations.parseScalaDeclaration(
        "@deprecated(\"use parse\") def legacy(): Unit = ()",
      ),
      ScalaDeclarations.parseScalaDeclaration("@main"),
      ScalaDeclarations.parseScalaDeclaration("@deprecated("),
    ],
    [
      { kind: "function", name: "Main", modifiers: ["public"] },
      { kind: "function", name: "legacy", modifiers: ["public"] },
      undefined,
      undefined,
    ],
  );

  // The static lane reads whatever a repository holds, including a file that is
  // mid-edit. A head whose parameters never close, and a brace that never
  // closes, both have to bound themselves where they start: running to the end
  // of the file would reparent every declaration after them.
  TestValidator.equals(
    "an unterminated Scala head or brace bounds itself, not the rest of the file",
    [
      ScalaDeclarations.scalaDeclarationEndIndex(["def apply("], 0),
      ScalaDeclarations.scalaDeclarationEndIndex(
        ["object Braced {", "  def inside(): Unit = ()"],
        0,
      ),
    ],
    [0, 0],
  );
};
