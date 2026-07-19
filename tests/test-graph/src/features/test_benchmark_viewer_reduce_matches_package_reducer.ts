import { TestValidator } from "@nestia/e2e";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { GraphPaths } from "../internal/GraphPaths";

/** The benchmark copy must preserve the package reducer's path semantics. */
export const test_benchmark_viewer_reduce_matches_package_reducer = async () => {
  const viewer = (await import(
    pathToFileURL(
      path.join(
        GraphPaths.repositoryRoot,
        "tests",
        "benchmark",
        "graph",
        "viewer.mjs",
      ),
    ).href
  )) as {
    reduce: (
      dump: { nodes: unknown[]; edges: unknown[] },
      options?: { keepExternal?: boolean },
    ) => { nodes: Array<{ id: string; file: string }>; links: Array<{ kind: string }> };
  };
  const sameFile = viewer.reduce({
    nodes: [
      node("C:/Only/File.ts", "A"),
      node("c:/only/File.ts", "B"),
    ],
    edges: [edge("C:/Only/File.ts", "A", "c:/only/File.ts", "B", "overrides")],
  });
  TestValidator.equals(
    "the benchmark viewer retains a single absolute filename",
    sameFile.nodes.map((entry) => entry.file),
    ["File.ts", "File.ts"],
  );
  TestValidator.equals(
    "the benchmark viewer retains filename-based identity",
    sameFile.nodes.map((entry) => entry.id.slice(0, entry.id.indexOf("#"))),
    ["File.ts", "File.ts"],
  );
  TestValidator.equals(
    "override edges use the heritage display family",
    sameFile.links[0]?.kind,
    "heritage",
  );
};

const node = (file: string, name: string) => ({
  id: `${file}#${name}:method`,
  name,
  kind: "method",
  file,
  external: false,
});

const edge = (fromFile: string, from: string, toFile: string, to: string, kind: string) => ({
  from: `${fromFile}#${from}:method`,
  to: `${toFile}#${to}:method`,
  kind,
});
