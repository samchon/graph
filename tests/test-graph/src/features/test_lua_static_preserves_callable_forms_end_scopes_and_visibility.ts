import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";

export const test_lua_static_preserves_callable_forms_end_scopes_and_visibility = async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-lua-"));
  fs.writeFileSync(
    path.join(root, "pipeline.lua"),
    [
      "local M = {}",
      "",
      "local function leaf()",
      "  return 1",
      "end",
      "",
      "local function private_helper()",
      "  leaf()",
      "end",
      "",
      "local assigned_local = function()",
      "  private_helper()",
      "end",
      "",
      "function M.draw_section()",
      "  if enabled then",
      "    private_helper()",
      "  end",
      "end",
      "",
      "function M:draw()",
      "  repeat",
      "    private_helper()",
      "  until ready",
      "end",
      "",
      "M.assigned = function()",
      "  private_helper()",
      "end",
      "",
      "local Hidden = {}",
      "function Hidden.secret()",
      "  private_helper()",
      "end",
      "",
      "local callbacks = {",
      "  invoke = function(self)",
      "    private_helper()",
      "  end,",
      "}",
      "",
      "function global_entry()",
      "  private_helper()",
      "end",
      "",
      "--[=[ function Fake() if true then end end ]=]",
      "local text = [=[ function AlsoFake() end ]=]",
      "return M",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(root, "literal.lua"),
    [
      "local function literal_helper()",
      "  return 1",
      "end",
      "",
      "local function literal_private()",
      "  return literal_helper()",
      "end",
      "",
      "return {",
      "  public_name = literal_helper,",
      "}",
      "",
    ].join("\n"),
  );

  const graph = await buildGraphDump({
    cwd: root,
    mode: "static",
    languages: ["lua"],
  });
  const named = (name: string) =>
    graph.nodes.find((node) => (node.qualifiedName ?? node.name) === name);
  const calls = (from: string, to: string) =>
    graph.edges.some(
      (edge) =>
        edge.kind === "calls" &&
        edge.from === named(from)?.id &&
        edge.to === named(to)?.id,
    );

  TestValidator.predicate(
    "Lua declaration forms preserve their spelling and callable kind",
    named("private_helper")?.kind === "function" &&
      named("assigned_local")?.kind === "function" &&
      named("M.draw_section")?.kind === "function" &&
      named("M.draw")?.kind === "method" &&
      named("M.assigned")?.kind === "function" &&
      named("callbacks.invoke")?.kind === "method",
  );
  TestValidator.equals(
    "Lua strings and long comments do not become declarations",
    [named("Fake"), named("AlsoFake")],
    [undefined, undefined],
  );
  TestValidator.predicate(
    "nested if/repeat blocks retain each callable's complete body",
    calls("private_helper", "leaf") &&
      calls("assigned_local", "private_helper") &&
      calls("M.draw_section", "private_helper") &&
      calls("M.draw", "private_helper") &&
      calls("M.assigned", "private_helper") &&
      calls("Hidden.secret", "private_helper") &&
      calls("callbacks.invoke", "private_helper") &&
      calls("global_entry", "private_helper"),
  );
  TestValidator.equals(
    "only globals and members of the returned module table are exported",
    [
      named("private_helper")?.modifiers,
      named("leaf")?.modifiers,
      named("assigned_local")?.modifiers,
      named("M.draw_section")?.modifiers,
      named("M.draw")?.modifiers,
      named("M.assigned")?.modifiers,
      named("Hidden.secret")?.modifiers,
      named("callbacks.invoke")?.modifiers,
      named("global_entry")?.modifiers,
      named("literal_helper")?.modifiers,
      named("literal_private")?.modifiers,
    ],
    [
      ["private"],
      ["private"],
      ["private"],
      ["public"],
      ["public"],
      ["public"],
      ["private"],
      ["private"],
      ["public"],
      ["public"],
      ["private"],
    ],
  );
  TestValidator.equals(
    "private Lua callables do not leak onto the module export surface",
    [
      named("private_helper")?.exported,
      named("leaf")?.exported,
      named("assigned_local")?.exported,
      named("M.draw_section")?.exported,
      named("M.draw")?.exported,
      named("M.assigned")?.exported,
      named("Hidden.secret")?.exported,
      named("callbacks.invoke")?.exported,
      named("global_entry")?.exported,
      named("literal_helper")?.exported,
      named("literal_private")?.exported,
    ],
    [
      undefined,
      undefined,
      undefined,
      true,
      true,
      true,
      undefined,
      undefined,
      true,
      true,
      undefined,
    ],
  );
};
