import { TestValidator } from "@nestia/e2e";
import {
  ISamchonGraphEdge,
  ISamchonGraphNode,
  SamchonGraphMemory,
  reduce,
  semanticGraphNodeId,
  wireEdges,
  wireNodes,
} from "@samchon/graph";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { GraphPaths } from "../internal/GraphPaths";

export const test_semantic_identity_round_trip_preserves_graph_references = async () => {
  const classId = id("Demo", "class", "T:Demo");
  const methodId = id("Demo.run()", "method", "M:Demo.run()");
  const nodes: ISamchonGraphNode[] = [
    node(classId, "Demo", "class", 1, 9),
    {
      ...node(methodId, "run()", "method", 3, 6),
      qualifiedName: "Demo.run()",
    },
  ];
  const edges: ISamchonGraphEdge[] = [
    {
      from: classId,
      to: methodId,
      kind: "contains",
      evidence: nodes[1]!.evidence,
    },
    {
      from: methodId,
      to: classId,
      kind: "type_ref",
      evidence: {
        file: "src/Demo.java",
        startLine: 4,
        startCol: 5,
        endLine: 4,
        endCol: 9,
      },
    },
    {
      from: methodId,
      to: classId,
      kind: "calls",
      evidence: {
        file: "src/Demo.java",
        startLine: 5,
        startCol: 5,
        endLine: 5,
        endCol: 9,
      },
    },
  ];
  const wireNodesResult = wireNodes(nodes);
  const wireEdgesResult = wireEdges(edges, nodes);
  TestValidator.equals(
    "semantic edge evidence still compresses against the source node file",
    wireEdgesResult[1]?.evidence?.file,
    undefined,
  );

  const memory = SamchonGraphMemory.from({
    project: "/demo",
    languages: ["java"],
    indexer: "lsp",
    nodes: wireNodesResult,
    edges: wireEdgesResult,
  });
  TestValidator.equals(
    "dump reload preserves semantic endpoints",
    memory.outgoing(methodId).map((edge) => [edge.kind, edge.to]),
    [["type_ref", classId], ["calls", classId]],
  );
  TestValidator.equals(
    "dump reload restores semantic edge evidence from its source node",
    memory.outgoing(methodId)[0]?.evidence?.file,
    "src/Demo.java",
  );
  TestValidator.predicate(
    "explicit semantic containment survives resident synthesis",
    memory.outgoing(classId).some(
      (edge) => edge.kind === "contains" && edge.to === methodId,
    ),
  );

  const { runTour } = await import(
    pathToFileURL(
      path.join(GraphPaths.graphPackageRoot, "lib", "operations", "runTour.js"),
    ).href,
  ) as {
    runTour: (
      graph: SamchonGraphMemory,
      props: { type: "tour"; reinterpretations: string[]; limit: number },
      question: string,
    ) => {
      result: {
        primaryFlow: Array<{
          reached: Array<{ id: string; file?: string; kind?: string }>;
        }>;
      };
    };
  };
  const tour = runTour(
    memory,
    { type: "tour", reinterpretations: ["Demo.run()"], limit: 1 },
    "Demo.run",
  );
  TestValidator.equals(
    "a tour keeps the opaque reached handle location",
    tour.result.primaryFlow
      .flatMap((flow) => flow.reached)
      .find((node) => node.id === classId),
    {
      id: classId,
      name: "Demo",
      file: "src/Demo.java",
      kind: "class",
      line: 1,
    },
  );

  const viewed = reduce({
    project: "C:/demo",
    nodes: nodes.map((entry) => ({
      id: entry.id,
      name: entry.name,
      kind: entry.kind,
      file: `C:/demo/${entry.file}`,
    })),
    edges: edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      kind: edge.kind,
    })),
  });
  TestValidator.equals(
    "viewer rerooting treats semantic ids as opaque link keys",
    viewed.nodes.map((entry) => entry.id).sort(),
    [classId, methodId].sort(),
  );
  TestValidator.predicate(
    "viewer links retain semantic endpoints",
    viewed.links.every(
      (edge) =>
        [classId, methodId].includes(edge.source) &&
        [classId, methodId].includes(edge.target),
    ),
  );
};

const id = (
  displayName: string,
  role: "class" | "method",
  nativeKey: string,
): string =>
  semanticGraphNodeId(
    {
      version: 2,
      language: "java",
      symbol: displayName,
      role,
      native: { key: nativeKey, stability: "semantic" },
      ...(role === "method" ? { overload: "parameters=" } : {}),
      stability: "persistent",
    },
    displayName,
  );

const node = (
  id: string,
  name: string,
  kind: "class" | "method",
  startLine: number,
  endLine: number,
): ISamchonGraphNode => ({
  id,
  kind,
  language: "java",
  name,
  file: "src/Demo.java",
  external: false,
  evidence: { file: "src/Demo.java", startLine, endLine },
});
