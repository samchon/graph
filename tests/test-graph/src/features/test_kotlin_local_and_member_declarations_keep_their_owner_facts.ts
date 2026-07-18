import { TestValidator } from "@nestia/e2e";

import { KotlinDeclarations } from "@samchon/graph-sitter";

export const test_kotlin_local_and_member_declarations_keep_their_owner_facts = () => {
  // A Kotlin secondary constructor is spelled `constructor(...)`, with no name
  // of its own: the class it is written in supplies its identity. Reading it as
  // an ordinary member would leave the class's other initialisers colliding
  // under one name, and reading it outside a class would invent a callable.
  TestValidator.equals(
    "a secondary constructor takes its class's name and its own visibility",
    [
      KotlinDeclarations.parseKotlinDeclaration(
        "constructor(value: Int) : this(value, null)",
        "Scope",
        "class",
      ),
      KotlinDeclarations.parseKotlinDeclaration(
        "private constructor()",
        "demo.Scope",
        "class",
      ),
      KotlinDeclarations.parseKotlinDeclaration("constructor(value: Int)"),
      // An anonymous type owner supplies no name, so the constructor falls back
      // to the language keyword rather than borrowing an owner it does not have.
      KotlinDeclarations.parseKotlinDeclaration(
        "constructor(value: Int)",
        undefined,
        "class",
      ),
    ],
    [
      { kind: "constructor", name: "Scope", modifiers: ["public"] },
      { kind: "constructor", name: "Scope", modifiers: ["private"] },
      undefined,
      { kind: "constructor", name: "constructor", modifiers: ["public"] },
    ],
  );

  // Kotlin lets a function declare classes and functions inside its body. They
  // are reachable from nowhere but that body, so they carry no visibility of
  // their own and cannot reach the module's export surface.
  TestValidator.equals(
    "declarations inside a Kotlin callable are local and carry no visibility",
    [
      KotlinDeclarations.parseKotlinDeclaration(
        "class LocalType(val value: Int)",
        "load",
        "method",
      ),
      KotlinDeclarations.parseKotlinDeclaration(
        "fun helper(value: Int): Int = value",
        "load",
        "method",
      ),
      KotlinDeclarations.parseKotlinDeclaration("class LocalType(val value: Int)"),
    ],
    [
      { kind: "class", name: "LocalType" },
      { kind: "function", name: "helper" },
      {
        kind: "class",
        name: "LocalType",
        exported: true,
        modifiers: ["public"],
      },
    ],
  );

  // An extension property's name is the member it adds, never the receiver it
  // adds it to -- and the receiver may carry both a type parameter list of its
  // own and generic arguments.
  TestValidator.equals(
    "a generic extension property is named for the member, not the receiver",
    [
      KotlinDeclarations.parseKotlinDeclaration(
        "val <T> List<T>.secondOrNull: T? get() = getOrNull(1)",
      ),
      KotlinDeclarations.parseKotlinDeclaration(
        "val Pair<Int, Int>.sum: Int get() = first + second",
      ),
    ],
    [
      {
        kind: "variable",
        name: "secondOrNull",
        exported: true,
        modifiers: ["public"],
      },
      { kind: "variable", name: "sum", exported: true, modifiers: ["public"] },
    ],
  );

  // A destructuring declaration binds several names at once and none of them is
  // written where a property's name would be. Naming it after its parentheses
  // would put a handle in the graph that no Kotlin caller can ever spell.
  TestValidator.equals(
    "a destructuring declaration does not manufacture a property",
    KotlinDeclarations.parseKotlinDeclaration(
      "val (name, age) = person",
      "load",
      "method",
    ),
    undefined,
  );
};
