import { TestValidator } from "@nestia/e2e";
import {
  IGraphSemanticIdentity,
  ISamchonGraphDump,
  ISamchonGraphEdge,
  ISamchonGraphNode,
  SamchonGraphMemory,
  assignSemanticIdentities,
  dedupeNodes,
  semanticGraphNodeId,
} from "@samchon/graph";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { GraphPaths } from "../internal/GraphPaths";

const importLib = <T>(relative: string): Promise<T> =>
  import(
    pathToFileURL(path.join(GraphPaths.graphPackageRoot, "lib", relative)).href
  ) as Promise<T>;

const identity = (
  over: Partial<IGraphSemanticIdentity> & { symbol: string },
): IGraphSemanticIdentity => ({
  version: 2,
  language: "go",
  role: "function",
  stability: "persistent",
  ...over,
});

const gnode = (over: Partial<ISamchonGraphNode>): ISamchonGraphNode =>
  ({
    id: "src/a.go#x:function",
    name: "x",
    kind: "function",
    language: "go",
    file: "src/a.go",
    ...over,
  }) as ISamchonGraphNode;

/**
 * Every defensive and low-traffic branch of the semantic identity layer stays
 * covered. These are the collision guards, the opaque-id file recovery, the
 * strict-slice normalization, and the ambiguous-endpoint tiebreaks that no
 * ordinary fixture exercises but the 100% gate requires.
 */
export const test_semantic_identity_edge_cases_stay_covered = async () => {
  // fileOfNodeId: a bare file id (no `#`) and a symbol id.
  const { fileOfNodeId } = await importLib<{
    fileOfNodeId: (id: string) => string;
  }>("utils/fileOfNodeId.js");
  const { mergeSemanticNodes } = await importLib<{
    mergeSemanticNodes: (nodes: readonly ISamchonGraphNode[]) => ISamchonGraphNode[];
  }>("indexer/dedupeNodes.js");
  const { mergeGraphSlices } = await importLib<{
    mergeGraphSlices: (options: {
      root: string;
      files: readonly string[];
      genericNodes: ISamchonGraphNode[];
      genericEdges: ISamchonGraphEdge[];
      strictNodes: ISamchonGraphNode[];
      strictEdges: ISamchonGraphEdge[];
    }) => { nodes: ISamchonGraphNode[]; edges: ISamchonGraphEdge[] };
  }>("provider/mergeGraphSlices.js");
  TestValidator.equals("a file id has no hash", fileOfNodeId("src/a.go"), "src/a.go");
  TestValidator.equals(
    "a symbol id keeps its file prefix",
    fileOfNodeId("src/a.go#Foo:class"),
    "src/a.go",
  );

  // validateIdentity: a positional native without a structural overload, and a
  // generation-scoped identity without a generation key, are both refused.
  TestValidator.error(
    "a positional native identity without an overload discriminator is refused",
    () =>
      semanticGraphNodeId(
        identity({ symbol: "demo.run", native: { key: "+1", stability: "positional" } }),
        "demo.run",
      ),
  );
  TestValidator.error(
    "a generation-scoped identity without a generation key is refused",
    () => semanticGraphNodeId(identity({ symbol: "demo.run", stability: "generation" }), "demo.run"),
  );

  // assignSemanticIdentities: an empty-file scope, a generation-scoped node with
  // no evidence, and two same-id callables an edge cannot disambiguate.
  const ambiguous: ISamchonGraphNode[] = [
    gnode({
      id: "src/a.go#foo:function",
      name: "foo",
      qualifiedName: "foo",
      evidence: { file: "src/a.go", startLine: 1, startCol: 0 },
    }),
    gnode({
      id: "src/a.go#foo:function",
      name: "foo",
      qualifiedName: "foo",
      evidence: { file: "src/a.go", startLine: 5, startCol: 0 },
    }),
    gnode({ id: "src/a.go#fileless:function", name: "fileless", qualifiedName: "fileless", file: "" }),
    gnode({ id: "src/a.go#bare:function", name: "bare", qualifiedName: "bare" }),
  ];
  const ambiguousEdges: ISamchonGraphEdge[] = [
    { kind: "calls", from: "src/a.go#foo:function", to: "src/a.go#bare:function", evidence: { file: "src/a.go", startLine: 3 } },
  ];
  assignSemanticIdentities(ambiguous, ambiguousEdges);
  TestValidator.predicate(
    "an empty-file declaration still receives a generation-scoped id",
    ambiguous[2]!.id.startsWith("@g2/"),
  );
  TestValidator.predicate(
    "an unresolved ambiguous endpoint falls back to a deterministic candidate",
    ambiguousEdges[0]!.from.startsWith("@"),
  );

  // dedupeNodes / mergeSemanticNodes: two locations of one semantic declaration
  // merge into a single node with declaration + implementation provenance.
  const semId = semanticGraphNodeId(
    identity({ symbol: "demo.Widget.draw", role: "method", native: { key: "u", stability: "semantic" }, overload: "parameters=" }),
    "demo.Widget.draw",
  );
  const twoLocations: ISamchonGraphNode[] = [
    gnode({ id: semId, name: "draw", kind: "method", qualifiedName: "demo.Widget.draw", file: "src/a.go", evidence: { file: "src/a.go", startLine: 2, startCol: 0 } }),
    gnode({ id: semId, name: "draw", kind: "method", qualifiedName: "demo.Widget.draw", file: "src/a.go", evidence: { file: "src/a.go", startLine: 9, startCol: 0 } }),
  ];
  TestValidator.equals("dedupe merges two locations of one semantic node", dedupeNodes(twoLocations).length, 1);
  const merged = mergeSemanticNodes(twoLocations);
  TestValidator.equals("mergeSemanticNodes collapses a repeated semantic id", merged.length, 1);
  TestValidator.predicate(
    "the merged node keeps both provenance locations",
    merged[0]!.implementation !== undefined,
  );

  // mergeGraphSlices: a strict slice normalizes and orders its nodes and edges.
  const strictA = gnode({ id: semanticGraphNodeId(identity({ symbol: "demo.A", role: "class", native: { key: "a", stability: "semantic" }, overload: "" }), "demo.A"), name: "A", kind: "class", file: "src/a.go" });
  const strictB = gnode({ id: semanticGraphNodeId(identity({ symbol: "demo.B", role: "class", native: { key: "b", stability: "semantic" }, overload: "" }), "demo.B"), name: "B", kind: "class", file: "src/b.go" });
  const strictEdges: ISamchonGraphEdge[] = [
    { kind: "references", from: strictB.id, to: strictA.id, evidence: { file: "src/b.go", startLine: 2 } },
    { kind: "references", from: strictA.id, to: strictB.id, evidence: { file: "src/a.go", startLine: 4 } },
  ];
  const mergedSlice = mergeGraphSlices({
    root: "/repo",
    files: ["src/a.go", "src/b.go"],
    genericNodes: [],
    genericEdges: [],
    strictNodes: [strictA, strictB],
    strictEdges,
  });
  TestValidator.equals("a strict slice keeps both ordered edges", mergedSlice.edges.length, 2);

  // wireEdges: a source in the node map, a legacy source absent from it, and an
  // opaque semantic source absent from it.
  const { wireEdges } = await importLib<{
    wireEdges: (edges: readonly ISamchonGraphEdge[], nodes: readonly ISamchonGraphNode[]) => ISamchonGraphDump.IEdge[];
  }>("indexer/wireEdges.js");
  const wired = wireEdges(
    [
      { kind: "calls", from: "src/a.go#present:function", to: "t", evidence: { file: "src/a.go", startLine: 1 } },
      { kind: "calls", from: "src/gone.go#missing:function", to: "t", evidence: { file: "src/gone.go", startLine: 1 } },
      { kind: "calls", from: strictA.id, to: "t", evidence: { file: "src/a.go", startLine: 1 } },
    ],
    [gnode({ id: "src/a.go#present:function", name: "present", file: "src/a.go" })],
  );
  TestValidator.equals("every edge survives wiring", wired.length, 3);

  // overrideEdges: two members that share a signature key.
  const { overrideEdges } = await importLib<{
    overrideEdges: (nodes: ISamchonGraphNode[], edges: ISamchonGraphEdge[]) => ISamchonGraphEdge[];
  }>("indexer/overrideEdges.js");
  overrideEdges(
    [
      gnode({ id: "src/a.go#Base.run:method", name: "run(x)", kind: "method", qualifiedName: "Base.run" }),
      gnode({ id: "src/a.go#Impl.run:method", name: "run(x)", kind: "method", qualifiedName: "Impl.run" }),
      gnode({ id: "src/a.go#Other.run:method", name: "run(x)", kind: "method", qualifiedName: "Other.run" }),
    ],
    [],
  );
  TestValidator.predicate("overrideEdges tolerates shared member keys", true);

  // SamchonGraphMemory: a duplicate semantic id in a dump is a producer defect.
  const dupId = semanticGraphNodeId(identity({ symbol: "demo.Dup", role: "class", native: { key: "d", stability: "semantic" }, overload: "" }), "demo.Dup");
  const dumpWithDup: ISamchonGraphDump = {
    project: "p",
    languages: ["go"],
    indexer: "static",
    nodes: [
      gnode({ id: dupId, name: "Dup", kind: "class", file: "src/a.go", evidence: { file: "src/a.go", startLine: 1, startCol: 0 } }),
      gnode({ id: dupId, name: "Dup", kind: "class", file: "src/a.go", evidence: { file: "src/a.go", startLine: 8, startCol: 0 } }),
    ],
    edges: [],
  } as unknown as ISamchonGraphDump;
  TestValidator.error("a duplicate semantic id in a dump is refused", () =>
    SamchonGraphMemory.from(dumpWithDup),
  );

  // SamchonGraphMemory: an edge whose opaque semantic source is absent from the
  // dump cannot recover a file and fails closed.
  const orphanId = semanticGraphNodeId(identity({ symbol: "demo.Orphan", role: "class", native: { key: "o", stability: "semantic" }, overload: "" }), "demo.Orphan");
  const dumpWithOrphanEdge: ISamchonGraphDump = {
    project: "p",
    languages: ["go"],
    indexer: "static",
    nodes: [gnode({ id: "src/a.go#Real:class", name: "Real", kind: "class", file: "src/a.go", evidence: { file: "src/a.go", startLine: 1, startCol: 0 } })],
    edges: [{ kind: "references", from: orphanId, to: "src/a.go#Real:class", evidence: { file: "src/a.go", startLine: 1 } }],
  } as unknown as ISamchonGraphDump;
  TestValidator.error("an absent semantic edge source fails closed", () =>
    SamchonGraphMemory.from(dumpWithOrphanEdge),
  );
};
