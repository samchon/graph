import { TestValidator } from "@nestia/e2e";

import { LuaDeclarations } from "@samchon/graph-sitter";

export const test_lua_comments_and_strings_cannot_close_a_callable = () => {
  // Lua spells `end` in prose as readily as in code, and every one of its
  // comment and string forms can carry a whole function body: a line comment, a
  // quoted string with an escaped quote, a long comment, and a long string that
  // runs across lines. If any of them leaks into the scan, the `end` inside it
  // closes a block the author never opened and the callable after it inherits
  // the wrong body.
  const lines = [
    "-- function ghost_from_line_comment() end",
    'local greeting = "function ghost_from_double_quote() end"',
    "local escaped = 'it\\'s a function ghost_from_single_quote() end'",
    "--[==[",
    "function ghost_from_long_comment()",
    "end",
    "]==]",
    "local doc = [[",
    "function ghost_from_long_string()",
    "end",
    "]]",
    "",
    "function report()",
    "  return greeting .. escaped .. doc",
    "end",
    "",
    "return report",
  ];
  const scanned = LuaDeclarations.scan(lines);

  TestValidator.equals(
    "no Lua comment or string form manufactures a declaration or steals an `end`",
    [...scanned].map(([start, declaration]) => [
      start,
      declaration.name,
      declaration.endIndex,
    ]),
    [[12, "report", 14]],
  );
  TestValidator.equals(
    "the callable a masked `end` could have closed keeps its own visibility",
    [...scanned.values()].map((declaration) => [
      declaration.modifiers,
      declaration.exported,
    ]),
    [[["public"], true]],
  );
};
