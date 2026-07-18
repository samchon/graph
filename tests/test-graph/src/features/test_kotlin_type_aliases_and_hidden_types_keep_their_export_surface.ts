import { TestValidator } from "@nestia/e2e";

import { KotlinDeclarations } from "@samchon/graph-sitter";

export const test_kotlin_type_aliases_and_hidden_types_keep_their_export_surface = () => {
  // A `typealias` is a type the file publishes under its own name, not a class
  // and not a property; a consumer imports it exactly as it imports a class.
  // Its head is also the one Kotlin type head that is incomplete until its `=`
  // arrives, so reading it as a class would both mis-kind it and mis-bound it.
  TestValidator.equals(
    "a Kotlin typealias is a type declaration on the module's export surface",
    [
      KotlinDeclarations.parseKotlinDeclaration(
        "typealias Handler = (String) -> Unit",
      ),
      KotlinDeclarations.parseKotlinDeclaration(
        "internal typealias Rows = List<Map<String, Any>>",
      ),
    ],
    [
      {
        kind: "type",
        name: "Handler",
        exported: true,
        modifiers: ["public"],
      },
      { kind: "type", name: "Rows", modifiers: ["internal"] },
    ],
  );
  // Kotlin allows newlines before a typealias's `=`. Every other type head is
  // complete at its name, so a head rule that stopped at `Registry<K, V>` would
  // publish a class-shaped type and leave `= MutableMap<K, V>` to be read as a
  // declaration of its own.
  TestValidator.equals(
    "a typealias head is incomplete until its `=` arrives, even a line later",
    KotlinDeclarations.kotlinDeclarationHeader(
      ["typealias Registry<K, V>", "    = MutableMap<K, V>", "class After"],
      0,
    ),
    "typealias Registry<K, V> = MutableMap<K, V>",
  );

  // `exported` is the module's surface, not a synonym for `public`. A type that
  // is private, internal, or nested is reachable through its owner or its file
  // and nowhere else, so it must not seed the surface a consumer imports from.
  TestValidator.equals(
    "only a public top-level Kotlin type seeds the module's export surface",
    [
      KotlinDeclarations.parseKotlinDeclaration("class Public"),
      KotlinDeclarations.parseKotlinDeclaration("private class Hidden"),
      KotlinDeclarations.parseKotlinDeclaration("internal class Shared"),
      KotlinDeclarations.parseKotlinDeclaration("class Inner", "Outer", "class"),
    ].map((declaration) => [declaration?.name, declaration?.exported]),
    [
      ["Public", true],
      ["Hidden", undefined],
      ["Shared", undefined],
      ["Inner", undefined],
    ],
  );
};
