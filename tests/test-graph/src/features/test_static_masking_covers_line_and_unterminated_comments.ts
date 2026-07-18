import fs from "node:fs";
import path from "node:path";

import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";

import { GraphPaths } from "../internal/GraphPaths";
import type { GraphLanguage, ISamchonGraphDump } from "@samchon/graph";

/**
 * Two comment forms the broader masking suite never reaches: a Lua `--` *line*
 * comment (its long-bracket `--[[ ]]` form takes a different lane) and a block
 * comment that is never closed. A call written inside either must be masked, so
 * no dependency edge survives — the same guarantee the masker gives every other
 * comment shape.
 */
export const test_static_masking_covers_line_and_unterminated_comments =
  async () => {
    // A Lua `--` line comment (not the `--[[` long-bracket form) hides the call.
    await assertMaskedCall(
      "lua",
      "lua",
      "sink.lua",
      [
        "function ghost() end",
        "function noise()",
        "  -- ghost()",
        "end",
      ],
    );

    // A block comment opened with `/*` and never closed masks the rest of the
    // file, including a call left inside it. The complete declarations precede
    // it, so they are still indexed while the trailing comment is masked to EOF.
    await assertMaskedCall(
      "c",
      "c",
      "sink.c",
      [
        "void ghost() {",
        "}",
        "void noise() {",
        "}",
        "/* ghost();",
      ],
    );
  };

async function assertMaskedCall(
  language: Exclude<GraphLanguage, "unknown">,
  extension: string,
  file: string,
  source: string[],
): Promise<void> {
  const root = GraphPaths.createTempDirectory(`samchon-static-comment-${language}-`);
  fs.writeFileSync(path.join(root, file), source.join("\n"));
  const dump = await buildGraphDump({ cwd: root, mode: "static", languages: [language] });
  const ghost = nodeNamed(dump, "ghost");
  TestValidator.predicate(
    `${language}: the masked target still declares itself`,
    ghost !== undefined,
  );
  TestValidator.equals(
    `${language}: a call inside the comment produces no dependency edge`,
    dump.edges.some((edge) => edge.kind === "calls" && edge.to === ghost?.id),
    false,
  );
}

function nodeNamed(dump: ISamchonGraphDump, name: string) {
  return dump.nodes.find((node) => node.name === name);
}
