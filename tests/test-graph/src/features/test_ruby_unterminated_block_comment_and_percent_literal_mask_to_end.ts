import fs from "node:fs";
import path from "node:path";

import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";

import { GraphPaths } from "../internal/GraphPaths";

/**
 * Ruby's `=begin` block comment and its `%`-literals both run until a closing
 * token that a mid-edit or generated file may never write. When the token is
 * absent the construct owns the rest of the file, so a call spelled inside it is
 * masked text, not a dependency. Stopping the mask early would attach an edge to
 * whatever the unterminated literal happened to quote.
 */
export const test_ruby_unterminated_block_comment_and_percent_literal_mask_to_end =
  async () => {
    const ghostCalls = async (source: readonly string[]): Promise<number> => {
      const root = GraphPaths.createTempDirectory("samchon-ruby-eof-mask-");
      fs.writeFileSync(path.join(root, "fixture.rb"), source.join("\n"));
      const dump = await buildGraphDump({
        cwd: root,
        mode: "static",
        languages: ["ruby"],
      });
      const ghost = dump.nodes.find((node) => node.name === "ghost");
      return dump.edges.filter(
        (edge) => edge.to === ghost?.id && edge.kind === "calls",
      ).length;
    };

    // The positive control: the same call in ordinary code is a real edge, so a
    // zero count below is masking at work rather than a call that never formed.
    TestValidator.predicate(
      "a call written in ordinary code produces a dependency edge",
      (await ghostCalls(["def ghost", "end", "def caller", "  ghost()", "end"])) >
        0,
    );

    // An `=begin` with no matching `=end` masks every following line to the end
    // of the file, so the `ghost()` it swallows is not a call from `caller`.
    TestValidator.equals(
      "an unterminated =begin block comment masks the reference that follows it",
      await ghostCalls(["def ghost", "end", "def caller", "=begin", "  ghost()"]),
      0,
    );

    // A `%w[...]` word literal with no closing `]` runs to the end of the file
    // just the same, so the `ghost()` inside it is quoted text, not a call.
    TestValidator.equals(
      "an unterminated %-literal masks the reference that follows it",
      await ghostCalls(["def ghost", "end", "def caller", "  %w[ghost()", "end"]),
      0,
    );
  };
