import { TestValidator } from "@nestia/e2e";

import { RubyDeclarations } from "@samchon/graph-sitter";

/**
 * Ruby closes classes, modules, methods, loops, and conditionals with the same
 * `end`. Ownership therefore depends on counting exactly the block openers the
 * language actually opens: one miscount transfers every later method to the
 * wrong owner, or ends a class at the first loop inside it.
 */
export const test_ruby_block_keywords_bound_end_scopes = () => {
  // Each body sits inside `run`; `after` must remain a sibling method of the
  // class rather than being nested into, or cut off by, the construct above it.
  const bounded = (fact: string, body: readonly string[]): void => {
    const lines = [
      "class Guard",
      "  def run(items, flag)",
      ...body,
      "  end",
      "",
      "  def after",
      "    :ok",
      "  end",
      "end",
    ];
    const afterIndex = body.length + 4;
    TestValidator.equals(fact, [...RubyDeclarations.scan(lines).entries()], [
      [0, { kind: "class", name: "Guard", endIndex: lines.length - 1, exported: true, modifiers: ["public"] }],
      [1, { kind: "method", name: "run", endIndex: body.length + 2, exported: true, modifiers: ["public"] }],
      [afterIndex, { kind: "method", name: "after", endIndex: afterIndex + 2, exported: true, modifiers: ["public"] }],
    ]);
  };

  // A loop's `do` is part of the loop, not a second block: counting both opens
  // one more scope than the single `end` closes.
  bounded("`while ... do ... end` opens exactly one block", [
    "    while flag do",
    "      work",
    "    end",
  ]);
  bounded("`until ... do ... end` opens exactly one block", [
    "    until flag do",
    "      work",
    "    end",
  ]);
  bounded("`for ... in ... do ... end` opens exactly one block", [
    "    for item in items do",
    "      item",
    "    end",
  ]);
  // A block-call `do` has no loop to belong to, so it is its own block.
  bounded("a `do` block passed to a method is its own block", [
    "    items.each do |item|",
    "      item",
    "    end",
  ]);

  bounded("`case ... when ... end` opens exactly one block", [
    "    case items",
    "    when 1 then :a",
    "    else :b",
    "    end",
  ]);
  bounded("`begin ... rescue ... end` opens exactly one block", [
    "    begin",
    "      work",
    "    rescue StandardError",
    "      :failed",
    "    end",
  ]);

  // `if` as an expression opens a block; `if` as a statement modifier does not.
  // The difference is what precedes the keyword on the statement.
  bounded("an `if` assigned to a value opens a block", [
    "    value = if flag",
    "      1",
    "    end",
    "    value",
  ]);
  bounded("an `if` after `or` opens a block", [
    "    items or if flag",
    "      work",
    "    end",
  ]);
  bounded("an `if` after `then` opens a block", [
    "    case items",
    "    when 1 then if flag",
    "      work",
    "    end",
    "    end",
  ]);
  // The negative twin: the same keyword one property away must NOT open a block.
  bounded("a trailing modifier `if` opens no block", [
    "    return 1 if flag",
  ]);
  bounded("a trailing modifier `unless` opens no block", [
    "    return 1 unless flag",
  ]);
  bounded("a trailing modifier `while` opens no block", [
    "    work while flag",
  ]);

  // Block keywords are only keywords in code position. As a symbol, a method
  // name, or a hash key they are data and open nothing.
  bounded("keywords used as symbols, methods, and hash keys open no block", [
    "    items.class",
    "    handlers = [:end, :begin]",
    "    opts = { if: true, end: 2 }",
    "    [handlers, opts]",
  ]);

  // A one-line `class`/`module` still opens and closes a real scope, and the
  // declaration index belongs to the outer head that started the line.
  TestValidator.equals(
    "a module opened on a one-line class keeps the class as the declaration",
    [...RubyDeclarations.scan(["class Registry; module Marker; end; end"]).entries()],
    [[0, { kind: "class", name: "Registry", endIndex: 0, exported: true, modifiers: ["public"] }]],
  );
  TestValidator.equals(
    "a def nested on a one-line def keeps the outer def as the declaration",
    [...RubyDeclarations.scan(["def outer; def inner; end; end"]).entries()],
    [[0, { kind: "method", name: "outer", endIndex: 0, exported: true, modifiers: ["public"] }]],
  );
};
