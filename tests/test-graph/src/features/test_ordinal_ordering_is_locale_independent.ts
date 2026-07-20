import { TestValidator } from "@nestia/e2e";
import { buildGraphDump, compareOrdinal } from "@samchon/graph";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { walkSourceFiles } from "../../../../packages/graph/src/utils/walkSourceFiles";
import { GraphPaths } from "../internal/GraphPaths";

const TEXT = ["z", "\u00e4", "a\u0308", "A", "a"];
const ORDINAL = ["A", "a", "a\u0308", "z", "\u00e4"];

/**
 * Graph identity and publication order must be canonical code-unit order, not
 * the host's collation rules. In particular, composed and decomposed Unicode
 * spellings are distinct identities and Windows preserves case in the order.
 */
export const test_ordinal_ordering_is_locale_independent = async () => {
  TestValidator.equals("ordinal text ordering is explicit", [...TEXT].sort(compareOrdinal), ORDINAL);
  TestValidator.equals("ordinal equality stays a comparator tie", compareOrdinal("same", "same"), 0);
  for (const locale of ["en_US.UTF-8", "sv_SE.UTF-8"] as const) {
    TestValidator.equals(
      `ordinal order ignores ${locale}`,
      sortedIn(locale),
      ORDINAL,
    );
  }

  const discoveryRoot = GraphPaths.createTempDirectory("samchon-ordinal-files-");
  // Windows file systems are ordinarily case-insensitive, so the filesystem
  // fixture cannot contain both `A.ts` and `a.ts`; the direct comparator
  // assertions above cover that distinct-order case.
  for (const file of ["\u00e4.ts", "z.ts", "a\u0308.ts", "A.ts", "b.ts"]) {
    fs.writeFileSync(path.join(discoveryRoot, file), "export {};\n");
  }
  TestValidator.equals(
    "a max-file cap takes the canonical ordinal prefix",
    walkSourceFiles(discoveryRoot, {
      extensions: new Set([".ts"]),
      maxFiles: 3,
    }).map((file) => path.basename(file)),
    ["A.ts", "a\u0308.ts", "b.ts"],
  );

  const ownerRoot = GraphPaths.createTempDirectory("samchon-ordinal-owner-");
  for (const file of ["a\u0308.hpp", "\u00e4.hpp"]) {
    fs.writeFileSync(
      path.join(ownerRoot, file),
      [
        "namespace sample {",
        "class Owner { public: void run(); };",
        "}",
      ].join("\n"),
    );
  }
  fs.writeFileSync(
    path.join(ownerRoot, "impl.cpp"),
    [
      "namespace sample {",
      "void Owner::run() {}",
      "}",
    ].join("\n"),
  );
  const graph = await buildGraphDump({
    cwd: ownerRoot,
    mode: "static",
    languages: ["cpp"],
  });
  const owner = graph.nodes.find(
    (node) =>
      node.file === "a\u0308.hpp" &&
      node.kind === "class" &&
      (node.qualifiedName ?? node.name) === "sample.Owner",
  );
  const method = graph.nodes.find(
    (node) =>
      node.file === "impl.cpp" &&
      node.kind === "method" &&
      (node.qualifiedName ?? node.name) === "sample.Owner.run",
  );
  TestValidator.predicate(
    "an ambiguous static owner tie chooses its ordinal declaration",
    owner !== undefined &&
      method !== undefined &&
      graph.edges.some(
        (edge) =>
          edge.kind === "contains" &&
          edge.from === owner.id &&
          edge.to === method.id,
      ),
  );
};

function sortedIn(locale: string): string[] {
  const script = [
    'const { compareOrdinal } = require("@samchon/graph");',
    `console.log(JSON.stringify(${JSON.stringify(TEXT)}.sort(compareOrdinal)));`,
  ].join(" ");
  return JSON.parse(
    execFileSync(process.execPath, ["--eval", script], {
      cwd: path.join(GraphPaths.repositoryRoot, "tests", "test-graph"),
      encoding: "utf8",
      env: { ...process.env, LANG: locale, LC_ALL: locale },
    }),
  ) as string[];
}
