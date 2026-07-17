import { TestValidator } from "@nestia/e2e";

import { RubyDeclarations } from "@samchon/graph-sitter";

/**
 * A Ruby method head carries its own visibility (`private def`), may spell its
 * parameters across lines, and may replace its body with `=`. Each shape
 * decides whether the following `end` belongs to the method or to its owner.
 */
export const test_ruby_method_heads_carry_visibility_and_arity = () => {
  // `private` on its own line opens a section: every later method is private
  // until the next visibility marker. `private def` is not a section — it
  // marks exactly one method and leaves the section's visibility alone.
  const sectioned = RubyDeclarations.scan([
    "class Guard",
    "  def first",
    "  end",
    "",
    "  private def marked",
    "  end",
    "",
    "  def still_public",
    "  end",
    "",
    "  private",
    "",
    "  def after_section",
    "  end",
    "",
    "  def also_private",
    "  end",
    "end",
  ]);
  TestValidator.equals(
    "`private def` marks one method without opening a private section",
    [...sectioned.values()].map((d) => [d.name, d.modifiers, d.exported]),
    [
      ["Guard", ["public"], true],
      ["first", ["public"], true],
      ["marked", ["private"], undefined],
      ["still_public", ["public"], true],
      ["after_section", ["private"], undefined],
      ["also_private", ["private"], undefined],
    ],
  );

  // A `private` section applies to every later method until the next marker,
  // and a `protected`/`public` marker ends it.
  TestValidator.equals(
    "a visibility section runs until the next visibility marker",
    [
      ...RubyDeclarations.scan([
        "class Guard",
        "  private",
        "  def hidden",
        "  end",
        "  protected",
        "  def guarded",
        "  end",
        "  public",
        "  def open",
        "  end",
        "end",
      ]).values(),
    ].map((d) => [d.name, d.modifiers]),
    [["Guard", ["public"]], ["hidden", ["private"]], ["guarded", ["protected"]], ["open", ["public"]]],
  );

  // A parameter list spelled across lines is still an ordinary method with a
  // body: the `end` two lines down closes the method, not the class.
  TestValidator.equals(
    "a method whose parameters span lines keeps its own body and end",
    [
      ...RubyDeclarations.scan([
        "class Guard",
        "  def call(",
        "    env,",
        "    options",
        "  )",
        "    env",
        "  end",
        "",
        "  def after",
        "  end",
        "end",
      ]).entries(),
    ],
    [
      [0, { kind: "class", name: "Guard", endIndex: 10, exported: true, modifiers: ["public"] }],
      [1, { kind: "method", name: "call", endIndex: 6, exported: true, modifiers: ["public"] }],
      [8, { kind: "method", name: "after", endIndex: 9, exported: true, modifiers: ["public"] }],
    ],
  );

  // An endless method has no `end` of its own; a parenthesised endless method
  // must not consume the class's `end` looking for one.
  TestValidator.equals(
    "an endless method claims no end, with or without parameters",
    [
      ...RubyDeclarations.scan([
        "class Guard",
        "  def bare = :value",
        "  def parameterised(path) = compile(path)",
        "",
        "  def after",
        "  end",
        "end",
      ]).entries(),
    ],
    [
      [0, { kind: "class", name: "Guard", endIndex: 6, exported: true, modifiers: ["public"] }],
      [1, { kind: "method", name: "bare", endIndex: 1, exported: true, modifiers: ["public"] }],
      [2, { kind: "method", name: "parameterised", endIndex: 2, exported: true, modifiers: ["public"] }],
      [4, { kind: "method", name: "after", endIndex: 5, exported: true, modifiers: ["public"] }],
    ],
  );

  // An explicit receiver makes a method a singleton method of the class, which
  // is public regardless of the surrounding private section.
  TestValidator.equals(
    "an explicit-receiver def is a public static method inside a private section",
    [
      ...RubyDeclarations.scan([
        "class Guard",
        "  private",
        "  def instance_hidden",
        "  end",
        "  def self.build",
        "  end",
        "  def Guard.legacy_build",
        "  end",
        "end",
      ]).values(),
    ].map((d) => [d.name, d.modifiers, d.exported]),
    [
      ["Guard", ["public"], true],
      ["instance_hidden", ["private"], undefined],
      ["build", ["public", "static"], true],
      ["legacy_build", ["public", "static"], true],
    ],
  );
};
