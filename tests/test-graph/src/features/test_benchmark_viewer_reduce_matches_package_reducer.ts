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
    ) => {
      nodes: Array<{ id: string; name: string; file: string }>;
      links: Array<{ kind: string }>;
    };
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

  const relativeFirst = mixedPathReduction(viewer.reduce, false);
  const absoluteFirst = mixedPathReduction(viewer.reduce, true);
  TestValidator.equals(
    "the benchmark viewer preserves a sibling identity beside a project-relative identity",
    pathCoordinates(relativeFirst),
    [
      ["Local", "src/local.ts", "src/local.ts"],
      ["Sibling", "D:/sibling/sibling.ts", "D:/sibling/sibling.ts"],
    ],
  );
  TestValidator.equals(
    "the benchmark viewer reroots an absolute-first legacy projection",
    pathCoordinates(absoluteFirst),
    [
      ["Local", "src/local.ts", "src/local.ts"],
      ["Sibling", "sibling.ts", "sibling.ts"],
    ],
  );
};

type ViewerReduce = (
  dump: { nodes: unknown[]; edges: unknown[] },
) => { nodes: Array<{ id: string; name: string; file: string }> };

const mixedPathReduction = (
  reduce: ViewerReduce,
  reversed: boolean,
): ReturnType<ViewerReduce> => {
  const nodes = [
    node("src/local.ts", "Local"),
    node("D:/sibling/sibling.ts", "Sibling"),
  ];
  return reduce({
    nodes: reversed ? nodes.reverse() : nodes,
    edges: [
      edge(
        "src/local.ts",
        "Local",
        "D:/sibling/sibling.ts",
        "Sibling",
        "calls",
      ),
    ],
  });
};

const pathCoordinates = (
  payload: ReturnType<ViewerReduce>,
): Array<[string, string, string]> =>
  payload.nodes
    .map(
      (entry): [string, string, string] => [
        entry.name,
        entry.file,
        entry.id.slice(0, entry.id.indexOf("#")),
      ],
    )
    .sort(([left], [right]) => left.localeCompare(right));

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
