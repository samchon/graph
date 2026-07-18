import { TestValidator } from "@nestia/e2e";

import { KotlinDeclarations } from "@samchon/graph-sitter";

/**
 * Two edges of Kotlin head reading: an extension property whose receiver carries
 * a generic argument list, so the property-name scan must balance `<`/`>` before
 * it can find the name; and a stray `@` that no identifier follows, which is not
 * an annotation and so leaves the head unrecognized rather than being erased.
 */
export const test_kotlin_property_receiver_generics_and_stray_annotations = () => {
  // `val <T> List<T>.mid` is an extension property. Its name sits past a generic
  // receiver, so the scanner has to track the angle brackets of `List<T>` to
  // land on `mid` rather than stopping inside the type arguments.
  TestValidator.equals(
    "an extension property is named past its generic receiver",
    KotlinDeclarations.parseKotlinDeclaration(
      "val <T> List<T>.mid: T get() = this[0]",
      "class",
    ),
    { kind: "variable", name: "mid", exported: true, modifiers: ["public"] },
  );

  // A `@` with no identifier after it is not an annotation. `eraseLeadingAnnotations`
  // leaves it in place, so the head still begins with `@` and matches no
  // declaration form: the parser declines rather than misreading `class Bar`.
  TestValidator.equals(
    "a stray at-sign is not stripped as an annotation",
    KotlinDeclarations.parseKotlinDeclaration("@ Foo class Bar"),
    undefined,
  );

  // A modifier fragment with no declaration keyword still yields its visibility:
  // the prefix scan finds no keyword to cut before, so it reads the whole
  // fragment as the modifier prefix rather than dropping it.
  TestValidator.equals(
    "a keyword-less head is read entirely as its modifier prefix",
    KotlinDeclarations.kotlinGraphModifiersOf("public", "class"),
    ["public"],
  );
};
