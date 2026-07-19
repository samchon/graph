import { TestValidator } from "@nestia/e2e";
import { reduce } from "@samchon/graph";

export const test_viewer_reduce_preserves_the_reference_contract = () => {
  const absolute = reduce(
    {
      project: "absolute",
      nodes: [
        node("C:/work/app/src/a.ts", "A", "class"),
        node("C:/work/app/src/b.ts", "B", "interface"),
        node("C:/work/app/src/c.ts", "C", "function"),
        node("C:/work/app/node_modules/pkg/index.d.ts", "External", "class", true),
      ],
      edges: [
        edge("C:/work/app/src/a.ts", "A", "class", "C:/work/app/src/b.ts", "B", "interface", "calls"),
        edge("C:/work/app/src/b.ts", "B", "interface", "C:/work/app/src/c.ts", "C", "function", "type_ref"),
        edge("C:/work/app/src/c.ts", "C", "function", "C:/work/app/src/a.ts", "A", "class", "extends"),
        edge(
          "C:/work/app/src/a.ts",
          "A",
          "class",
          "C:/work/app/node_modules/pkg/index.d.ts",
          "External",
          "class",
          "implements",
        ),
      ],
    },
    { maxNodes: 2 },
  );
  TestValidator.equals("the cap keeps two connected highest-degree nodes", absolute.counts.nodes, 2);
  TestValidator.equals("external leaves are dropped before capping", absolute.counts.droppedExternal, 1);
  TestValidator.equals("the cap count is reported", absolute.counts.droppedByCap, 1);
  TestValidator.predicate(
    "absolute paths are rerooted",
    absolute.nodes.every((entry) => !entry.file.includes("C:/work/app")),
  );
  TestValidator.equals(
    "call kinds collapse to the reference display family",
    absolute.links[0]?.kind,
    "value-call",
  );

  const relative = reduce(
    {
      nodes: [
        node("src/a.ts", "A", "class"),
        node("src/b.ts", "B", "class"),
        node("vendor/c.ts", "C", "class", true),
      ],
      edges: [
        edge("src/a.ts", "A", "class", "src/b.ts", "B", "class", "custom"),
        edge("src/b.ts", "B", "class", "vendor/c.ts", "C", "class", "implements"),
      ],
    },
    { keepExternal: true, maxNodes: 99 },
  );
  TestValidator.equals("relative paths keep their structure", relative.nodes[0]?.file, "src/a.ts");
  TestValidator.equals("unknown edge kinds pass through", relative.links[0]?.kind, "custom");
  TestValidator.equals("heritage kinds collapse", relative.links[1]?.kind, "heritage");
  TestValidator.equals("keepExternal retains boundary nodes", relative.counts.droppedExternal, 0);
  TestValidator.equals("an absent project defaults to empty", relative.project, "");

  const splitRoots = reduce({
    nodes: [
      node("C:/one/a.ts", "A", "class"),
      node("D:/two/b.ts", "B", "class"),
      node("C:/one/node_modules/pkg/x.d.ts", "X", "class", true),
      node("E:/outside/y.ts", "Y", "class", true),
    ],
    edges: [
      edge("C:/one/a.ts", "A", "class", "D:/two/b.ts", "B", "class", "instantiates"),
      edge("C:/one/a.ts", "A", "class", "C:/one/node_modules/pkg/x.d.ts", "X", "class", "renders"),
      edge("D:/two/b.ts", "B", "class", "E:/outside/y.ts", "Y", "class", "accesses"),
    ],
  }, { keepExternal: true });
  TestValidator.equals(
    "a disjoint absolute set falls back to portable basenames",
    splitRoots.nodes.map((entry) => entry.file),
    [
      "a.ts",
      "b.ts",
      "node_modules/pkg/x.d.ts",
      "y.ts",
    ],
  );
  TestValidator.predicate(
    "all execution edge spellings collapse",
    splitRoots.links.every((entry) => entry.kind === "value-call"),
  );

  const outsideRoot = reduce({
    nodes: [
      node("C:/work/src/a.ts", "A", "class"),
      node("C:/work/src/b.ts", "B", "class"),
      node("C:/vendor/node_modules/pkg/x.d.ts", "X", "class", true),
      node("C:/vendor/generated/y.ts", "Y", "class", true),
    ],
    edges: [
      edge("C:/work/src/a.ts", "A", "class", "C:/work/src/b.ts", "B", "class", "calls"),
      edge("C:/work/src/a.ts", "A", "class", "C:/vendor/node_modules/pkg/x.d.ts", "X", "class", "calls"),
      edge("C:/work/src/b.ts", "B", "class", "C:/vendor/generated/y.ts", "Y", "class", "calls"),
    ],
  }, { keepExternal: true });
  TestValidator.predicate(
    "outside node_modules paths retain their package suffix",
    outsideRoot.nodes.some((entry) => entry.file === "node_modules/pkg/x.d.ts"),
  );
  TestValidator.predicate(
    "other outside-root paths fall back to a basename",
    outsideRoot.nodes.some((entry) => entry.file === "y.ts"),
  );

  const slashlessOutside = reduce({
    nodes: [
      node("C:/work/src/a.ts", "A", "class"),
      node("C:/work/src/b.ts", "B", "class"),
      node("bare.ts", "Bare", "class", true),
    ],
    edges: [
      edge("C:/work/src/a.ts", "A", "class", "C:/work/src/b.ts", "B", "class", "calls"),
      edge("C:/work/src/a.ts", "A", "class", "bare.ts", "Bare", "class", "calls"),
    ],
  }, { keepExternal: true });
  TestValidator.predicate(
    "a slashless outside-root path remains intact",
    slashlessOutside.nodes.some((entry) => entry.file === "bare.ts"),
  );

  const sameFile = reduce({
    nodes: [
      node("C:/only/file.ts", "A", "class"),
      node("C:/only/file.ts", "B", "class"),
    ],
    edges: [edge("C:/only/file.ts", "A", "class", "C:/only/file.ts", "B", "class", "calls")],
  });
  TestValidator.equals(
    "a one-file absolute root retains the source filename",
    sameFile.nodes.map((entry) => entry.file),
    ["file.ts", "file.ts"],
  );
  TestValidator.equals(
    "a one-file absolute root retains filename-based node identity",
    sameFile.nodes.map((entry) => entry.id.slice(0, entry.id.indexOf("#"))),
    ["file.ts", "file.ts"],
  );

  const posixRoot = reduce({
    nodes: [
      node("/a.ts", "A", "class"),
      node("/b.ts", "B", "class"),
    ],
    edges: [edge("/a.ts", "A", "class", "/b.ts", "B", "class", "calls")],
  });
  TestValidator.equals(
    "files at the POSIX root retain their basenames",
    posixRoot.nodes.map((entry) => entry.file),
    ["a.ts", "b.ts"],
  );

  const caseSensitive = reduce({
    nodes: [
      node("/work/A/a.ts", "A", "class"),
      node("/work/a/b.ts", "B", "class"),
    ],
    edges: [
      edge(
        "/work/A/a.ts",
        "A",
        "class",
        "/work/a/b.ts",
        "B",
        "class",
        "calls",
      ),
    ],
  });
  TestValidator.equals(
    "POSIX common roots remain case-sensitive",
    caseSensitive.nodes.map((entry) => entry.file),
    ["A/a.ts", "a/b.ts"],
  );

  const mixedPathForms = mixedPathReduction(false);
  TestValidator.equals(
    "a relative-first current dump preserves its project path and sanitizes its absolute sibling",
    pathCoordinates(mixedPathForms),
    [
      ["Local", "src/local.ts", "src/local.ts"],
      ["Sibling", "sibling.ts", "sibling.ts"],
    ],
  );
  TestValidator.equals(
    "mixed current path reduction is independent of node order",
    pathCoordinates(mixedPathReduction(true)),
    pathCoordinates(mixedPathForms),
  );

  const unc = reduce({
    nodes: [
      node("\\\\SERVER\\Share\\project\\src\\a.ts", "A", "class"),
      node("//server/share/project/lib/b.ts", "B", "class"),
    ],
    edges: [
      edge(
        "\\\\SERVER\\Share\\project\\src\\a.ts",
        "A",
        "class",
        "//server/share/project/lib/b.ts",
        "B",
        "class",
        "calls",
      ),
    ],
  });
  TestValidator.equals(
    "UNC roots are rerooted case-insensitively without losing subdirectories",
    unc.nodes.map((entry) => entry.file),
    ["src/a.ts", "lib/b.ts"],
  );
  TestValidator.equals(
    "UNC-rooted node identities are rewritten with their files",
    unc.nodes.map((entry) => entry.id.slice(0, entry.id.indexOf("#"))),
    ["src/a.ts", "lib/b.ts"],
  );

  const hashless = reduce({
    nodes: [
      { id: "plain-a", name: "A", kind: "class", file: "a.ts" },
      { id: "plain-b", name: "B", kind: "class", file: "b.ts" },
    ],
    edges: [{ from: "plain-a", to: "plain-b", kind: "type_ref" }],
  });
  TestValidator.equals("hashless ids pass through", hashless.nodes.map((entry) => entry.id), ["plain-a", "plain-b"]);

  const orphan = reduce({ nodes: [node("single.ts", "Only", "class")], edges: [] });
  TestValidator.equals("orphans are pruned", orphan.counts.nodes, 0);
  TestValidator.equals("empty graphs have no common root", reduce({ nodes: [], edges: [] }).nodes, []);

  const externalOnly = reduce({
    nodes: [
      node("vendor/a.ts", "A", "class", true),
      node("vendor/b.ts", "B", "class", true),
    ],
    edges: [edge("vendor/a.ts", "A", "class", "vendor/b.ts", "B", "class", "type_ref")],
  }, { keepExternal: true });
  TestValidator.equals(
    "an external-only graph has no project root but remains renderable",
    externalOnly.counts.nodes,
    2,
  );
};

const mixedPathReduction = (reversed: boolean) => {
  const nodes = [
    node("src/local.ts", "Local", "class"),
    node("/workspace-sibling/sibling.ts", "Sibling", "class"),
  ];
  return reduce({
    nodes: reversed ? nodes.reverse() : nodes,
    edges: [
      edge(
        "src/local.ts",
        "Local",
        "class",
        "/workspace-sibling/sibling.ts",
        "Sibling",
        "class",
        "calls",
      ),
    ],
  });
};

const pathCoordinates = (
  payload: ReturnType<typeof reduce>,
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

const id = (file: string, name: string, kind: string) => `${file}#${name}:${kind}`;
const node = (file: string, name: string, kind: string, external = false) => ({
  id: id(file, name, kind),
  name,
  kind,
  file,
  ...(external ? { external: true } : {}),
});
const edge = (
  fromFile: string,
  fromName: string,
  fromKind: string,
  toFile: string,
  toName: string,
  toKind: string,
  kind: string,
) => ({
  from: id(fromFile, fromName, fromKind),
  to: id(toFile, toName, toKind),
  kind,
});
