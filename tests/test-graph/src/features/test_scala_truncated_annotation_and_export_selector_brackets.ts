import { TestValidator } from "@nestia/e2e";

import { ScalaDeclarations } from "@samchon/graph-sitter";

/**
 * Two Scala lexical edges the bounding rules have to walk without guessing: a
 * leading `@` whose annotation name never arrived, and an export selector whose
 * `given` carries a type with its own comma-separated parameters. Mishandling
 * either invents a declaration or an export name the source never wrote.
 */
export const test_scala_truncated_annotation_and_export_selector_brackets = () => {
  // The static lane sees heads that stop mid-edit. A lone `@` is an annotation
  // whose name was cut off; it is left in place rather than stripped, so what
  // follows is never mistaken for a stripped declaration, and it names nothing.
  TestValidator.equals(
    "a leading `@` with no annotation name declares nothing",
    [
      ScalaDeclarations.parseScalaDeclaration("@"),
      ScalaDeclarations.parseScalaDeclaration("@ def orphaned(): Unit = ()"),
    ],
    [undefined, undefined],
  );

  // A `given` selector may name a parameterized type, and the commas between its
  // type parameters are not selector separators. Splitting on them would publish
  // `Long` -- a type argument -- as if it were an exported member of its own.
  const exports = ScalaDeclarations.exportsOf([
    "export mod.{given Function2[Int, Long, String], run}",
  ]);
  TestValidator.equals(
    "type-parameter commas inside an export selector do not split into spurious names",
    exports.get(0)?.names,
    [{ name: "run" }],
  );
};
