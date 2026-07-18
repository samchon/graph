import { TestValidator } from "@nestia/e2e";

import { LuaDeclarations } from "@samchon/graph-sitter";

export const test_lua_member_identity_ignores_the_receiver_spelling = () => {
  // Lua's `obj:method(...)` is sugar for `obj.method(obj, ...)`: the two
  // spellings name one member, and a call site is free to pick either. A graph
  // that kept them apart would answer `M:draw` and `M.draw` with two handles
  // for the declaration a Lua author wrote once.
  TestValidator.equals(
    "method-call `:` and table-member `.` spell the same Lua member",
    [
      LuaDeclarations.canonicalName("M:draw"),
      LuaDeclarations.canonicalName("M.draw"),
      LuaDeclarations.canonicalName("ui.widget:render"),
      LuaDeclarations.canonicalName("draw"),
    ],
    ["M.draw", "M.draw", "ui.widget.render", "draw"],
  );
  TestValidator.equals(
    "a Lua member's leaf name survives however deep its receiver is written",
    [
      LuaDeclarations.leafName("M:draw"),
      LuaDeclarations.leafName("M.draw"),
      LuaDeclarations.leafName("ui.widget:render"),
      LuaDeclarations.leafName("ui.widget.render"),
      LuaDeclarations.leafName("draw"),
    ],
    ["draw", "draw", "render", "render", "draw"],
  );
  TestValidator.equals(
    "a Lua receiver becomes the declaration's owners, and a bare name has none",
    [
      LuaDeclarations.identityOf("M:draw"),
      LuaDeclarations.identityOf("ui.widget:render"),
      LuaDeclarations.identityOf("draw"),
    ],
    [
      { name: "draw", ownerNames: ["M"] },
      { name: "render", ownerNames: ["ui", "widget"] },
      { name: "draw" },
    ],
  );
};
