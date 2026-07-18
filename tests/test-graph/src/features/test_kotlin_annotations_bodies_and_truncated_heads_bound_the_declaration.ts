import { TestValidator } from "@nestia/e2e";

import { KotlinDeclarations } from "@samchon/graph-sitter";

export const test_kotlin_annotations_bodies_and_truncated_heads_bound_the_declaration = () => {
  // Kotlin's annotation-array form stacks several annotations in one `@[...]`,
  // and an annotation argument may itself be an array literal. Both put
  // brackets in the head the bounding rules walk; a bracket that is not counted
  // is a `{` seen at the wrong depth.
  TestValidator.equals(
    "an `@[...]` annotation array is erased down to the declaration it annotates",
    [
      KotlinDeclarations.parseKotlinDeclaration(
        '@[Suppress("unused") Deprecated("old")] class Annotated',
      ),
      KotlinDeclarations.parseKotlinDeclaration("@Marker class Annotated"),
      KotlinDeclarations.parseKotlinDeclaration("@field:Inject lateinit var repo: Repo"),
      KotlinDeclarations.parseKotlinDeclaration("@Marker"),
    ],
    [
      {
        kind: "class",
        name: "Annotated",
        exported: true,
        modifiers: ["public"],
      },
      {
        kind: "class",
        name: "Annotated",
        exported: true,
        modifiers: ["public"],
      },
      {
        kind: "variable",
        name: "repo",
        exported: true,
        modifiers: ["public"],
      },
      undefined,
    ],
  );

  const configure = [
    "fun configure(",
    "    @Values([1, 2, 3]) levels: IntArray,",
    ") {",
    "    apply(levels)",
    "}",
    "fun after() {}",
  ];
  TestValidator.equals(
    "an annotation's array literal cannot truncate a parameter list or its body",
    [
      KotlinDeclarations.kotlinDeclarationHeader(configure, 0),
      KotlinDeclarations.kotlinDeclarationEndIndex(configure, 0),
    ],
    ["fun configure( @Values([1, 2, 3]) levels: IntArray, ) {", 4],
  );

  // An expression body is not a block: it has no braces of its own to count, so
  // what it owns is whatever stays indented under it. Bounding it at its `=`
  // would drop the body; bounding it by the next `{}` would steal the next
  // declaration's.
  const expression = [
    "fun describe(): String =",
    "    buildString {",
    '        append("x")',
    "    }",
    "",
    "fun after() {}",
  ];
  TestValidator.equals(
    "an indented expression body belongs to the function it continues",
    [
      KotlinDeclarations.kotlinDeclarationEndIndex(expression, 0),
      KotlinDeclarations.kotlinDeclarationEndIndex(expression, 5),
    ],
    [3, 5],
  );

  // The static lane has no compiler to refuse a file that is mid-edit or
  // generated wrong. A head or body that never closes has to bound itself where
  // it starts: running to the end of the file would reparent everything after.
  TestValidator.equals(
    "a Kotlin head or body left unterminated bounds itself, not the file",
    [
      KotlinDeclarations.kotlinDeclarationEndIndex(["class Registry<"], 0),
      KotlinDeclarations.kotlinDeclarationEndIndex(
        ["class Broken {", "    fun member()"],
        0,
      ),
    ],
    [0, 0],
  );
  // The same file hands the parser heads that stop mid-name and mid-generics.
  // A parser that guessed would put a handle in the graph that names nothing a
  // caller can reach; declining is the only answer that stays honest.
  TestValidator.equals(
    "a head truncated before its name declares nothing rather than the wrong thing",
    [
      KotlinDeclarations.parseKotlinDeclaration("fun <T"),
      KotlinDeclarations.parseKotlinDeclaration("fun helper"),
      KotlinDeclarations.parseKotlinDeclaration("fun ("),
      KotlinDeclarations.parseKotlinDeclaration("val <T"),
    ],
    [undefined, undefined, undefined, undefined],
  );
};
