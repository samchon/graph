import { TestValidator } from "@nestia/e2e";

import { LuaDeclarations } from "@samchon/graph-sitter";

export const test_lua_loop_and_do_blocks_close_only_their_own_scope = () => {
  // Every Lua block form ends with the same `end`, so a callable's boundary is
  // whichever `end` is left once its loops and blocks have taken theirs. A
  // `for`/`while` header's own `do` opens no second scope, while a bare `do`
  // does; miscounting either hands the callable's `end` to the wrong owner and
  // makes the functions after it look nested.
  const lines = [
    "local M = {}",
    "",
    "function M.scan(items)",
    "  for _, item in ipairs(items) do",
    "    if item then",
    "      M.visit(item)",
    "    end",
    "  end",
    "  while M.pending() do",
    "    M.step()",
    "  end",
    "  do",
    "    M.flush()",
    "  end",
    "end",
    "",
    "local ok = pcall(function()",
    "  M.flush()",
    "end)",
    "",
    "function M.visit(item)",
    "  return item",
    "end",
    "",
    "function M.pending()",
    "  return false",
    "end",
    "",
    "function M.step() end",
    "function M.flush() end",
    "",
    "return M",
  ];

  TestValidator.equals(
    "loop and bare `do` blocks take their own `end`, leaving the callable its own",
    [...LuaDeclarations.scan(lines)].map(([start, declaration]) => [
      start,
      [...(declaration.ownerNames ?? []), declaration.name].join("."),
      declaration.endIndex,
    ]),
    [
      [2, "M.scan", 14],
      [20, "M.visit", 22],
      [24, "M.pending", 26],
      [28, "M.step", 28],
      [29, "M.flush", 29],
    ],
  );
  TestValidator.predicate(
    "an anonymous callback handed to a call is not a declaration of its own",
    ![...LuaDeclarations.scan(lines).values()].some(
      (declaration) => declaration.name === "ok",
    ),
  );
};
