import { TestValidator } from "@nestia/e2e";

import { LuaDeclarations } from "@samchon/graph-sitter";

export const test_lua_unbalanced_blocks_do_not_swallow_later_callables = () => {
  // The static lane indexes whatever a repository holds, including a file that
  // is mid-edit, generated from a template, or simply wrong: Lua has no header
  // to reject it and no compiler in this lane to refuse it. An `end` therefore
  // has to close the nearest block that its own keyword opened rather than the
  // nearest block of any kind, and an `end` that closes nothing has to close
  // nothing -- otherwise one unbalanced block in one file silently reparents
  // every callable after it.
  const lines = [
    "local function ready()",
    "  repeat",
    "    poll()",
    "end",
    "",
    "function after()",
    "  return 1",
    "end",
    "end",
    "",
    "return after",
  ];

  TestValidator.equals(
    "an unclosed `repeat` yields the `end` to the callable that opened first",
    [...LuaDeclarations.scan(lines)].map(([start, declaration]) => [
      start,
      declaration.name,
      declaration.endIndex,
    ]),
    [
      [0, "ready", 3],
      [5, "after", 7],
    ],
  );
  TestValidator.equals(
    "`local` and global visibility survive a file whose blocks do not balance",
    [...LuaDeclarations.scan(lines).values()].map((declaration) => [
      declaration.name,
      declaration.modifiers,
      declaration.exported,
    ]),
    [
      ["ready", ["private"], undefined],
      ["after", ["public"], true],
    ],
  );
};
