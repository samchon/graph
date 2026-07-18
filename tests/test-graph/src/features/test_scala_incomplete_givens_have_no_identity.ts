import { TestValidator } from "@nestia/e2e";

import { ScalaDeclarations } from "@samchon/graph-sitter";

/**
 * A Scala 3 `given` earns its identity from the type it provides. When the head
 * is truncated before that type ever appears, there is nothing to name, and a
 * best-effort parse must decline rather than invent one.
 */
export const test_scala_incomplete_givens_have_no_identity = () => {
  // `given [T]` carries only a type-parameter list — the provided type is
  // missing — so no identity can be recovered and the declaration is skipped.
  TestValidator.equals(
    "a given with type parameters but no provided type has no identity",
    ScalaDeclarations.parseScalaDeclaration("given [T]"),
    undefined,
  );

  // `given foo[T` looks like it could be a named given, but the `[` never
  // closes, so the parser cannot confirm a name/using list follows it. It falls
  // back to reading the whole remainder as the provided type of an anonymous
  // given rather than treating `foo` as a written name.
  const truncatedNamed = ScalaDeclarations.parseScalaDeclaration("given foo[T");
  TestValidator.predicate(
    "an unterminated bracket after a would-be given name yields an anonymous given",
    truncatedNamed?.kind === "variable" &&
      truncatedNamed.name.startsWith("given ") &&
      truncatedNamed.name.includes("foo"),
  );
};
