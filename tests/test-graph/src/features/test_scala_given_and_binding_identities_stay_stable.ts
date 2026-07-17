import { TestValidator } from "@nestia/e2e";

import { ScalaDeclarations } from "@samchon/graph-sitter";

export const test_scala_given_and_binding_identities_stay_stable = () => {
  // An anonymous Scala 3 `given` has no name the author wrote, so its identity
  // is the type it provides -- and that type sits after the using clause and
  // the type parameters, behind colons that belong to the parameters rather
  // than to the given. Metals reports a stable binding either way, so the
  // static lane has to reach the same spelling from the syntax alone.
  TestValidator.equals(
    "an anonymous given is identified by the type it provides",
    [
      ScalaDeclarations.parseScalaDeclaration(
        "given [T](using ord: Ordering[T]): Ordering[List[T]] = summon",
      ),
      ScalaDeclarations.parseScalaDeclaration(
        "given (using ctx: Context): Ordering[Int] = summon",
      ),
      ScalaDeclarations.parseScalaDeclaration("given Ordering[String] = summon"),
    ],
    [
      {
        kind: "variable",
        name: "given Ordering[List[T]]",
        modifiers: ["public", "readonly"],
      },
      {
        kind: "variable",
        name: "given Ordering[Int]",
        modifiers: ["public", "readonly"],
      },
      {
        kind: "variable",
        name: "given Ordering[String]",
        modifiers: ["public", "readonly"],
      },
    ],
  );

  // `val` is immutable and `var` is not: that is the whole difference between
  // them, and it is the one fact the graph's `readonly` carries. Inside a type
  // both are properties; at file scope both are variables.
  TestValidator.equals(
    "`val` is readonly, `var` is not, and the owner decides property or variable",
    [
      ScalaDeclarations.parseScalaDeclaration("val name: String = \"x\"", "class"),
      ScalaDeclarations.parseScalaDeclaration("var cursor: Int = 0", "class"),
      ScalaDeclarations.parseScalaDeclaration("var cursor: Int = 0"),
    ],
    [
      { kind: "property", name: "name", modifiers: ["public", "readonly"] },
      { kind: "property", name: "cursor", modifiers: ["public"] },
      { kind: "variable", name: "cursor", modifiers: ["public"] },
    ],
  );

  // Scala spells an auxiliary constructor `def this(...)`. Reading it as an
  // ordinary method would put a method literally named `this` on the class.
  TestValidator.equals(
    "`def this` is a constructor, not a method named `this`",
    [
      ScalaDeclarations.parseScalaDeclaration(
        "def this(value: Long) = this(value, 0)",
        "class",
      ),
      ScalaDeclarations.parseScalaDeclaration("def thisValue: Long = 0", "class"),
    ],
    [
      { kind: "constructor", name: "this", modifiers: ["public"] },
      { kind: "method", name: "thisValue", modifiers: ["public"] },
    ],
  );

  // Scala's backticks quote a name that is otherwise unspellable. The backticks
  // are the quoting, not the name a caller writes at the call site.
  TestValidator.equals(
    "a backtick-quoted Scala name is indexed without its quoting",
    [
      ScalaDeclarations.parseScalaDeclaration("def `is empty`(): Boolean = true", "class"),
      ScalaDeclarations.parseScalaDeclaration("class `Odd Name`"),
      ScalaDeclarations.parseScalaDeclaration("package `odd`.demo"),
    ],
    [
      { kind: "method", name: "is empty", modifiers: ["public"] },
      { kind: "class", name: "Odd Name", modifiers: ["public"] },
      { kind: "package", name: "odd.demo", modifiers: ["public"] },
    ],
  );
};
