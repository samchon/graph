import { ISamchonGraphEdge, ISamchonGraphNode } from "../structures";
import { dedupeEdges } from "../indexer/dedupeEdges";
import { dedupeNodes } from "../indexer/dedupeNodes";
import { finalizeGraph } from "../indexer/finalizeGraph";

/**
 * Merge ordinary LSP/static facts with compiler-owned strict slices.
 *
 * The generic lane still needs lexical structural derivations and duplicate
 * cleanup. Strict providers already resolved those facts and must pass through
 * unchanged. Cross-lane identity collisions are rejected rather than allowing
 * either lane to overwrite compiler truth.
 */
export function mergeGraphSlices(options: {
  root: string;
  files: readonly string[];
  genericNodes: ISamchonGraphNode[];
  genericEdges: ISamchonGraphEdge[];
  strictNodes: ISamchonGraphNode[];
  strictEdges: ISamchonGraphEdge[];
}): { nodes: ISamchonGraphNode[]; edges: ISamchonGraphEdge[] } {
  assertStrictSlice(options.strictNodes, options.strictEdges);
  const generic = finalizeGraph(
    options.root,
    options.files,
    options.genericNodes,
    options.genericEdges,
  );
  const genericNodes = dedupeNodes(generic.nodes);
  const genericEdges = dedupeEdges(generic.edges);
  const nodeIds = new Set(options.strictNodes.map((node) => node.id));
  const duplicateNode = genericNodes.find((node) => nodeIds.has(node.id));
  if (duplicateNode !== undefined) {
    throw new Error(
      `@samchon/graph: strict provider node collides with another lane: ${duplicateNode.id}`,
    );
  }
  const edgeKeys = new Set(options.strictEdges.map(edgeKey));
  const duplicateEdge = genericEdges.find((edge) => edgeKeys.has(edgeKey(edge)));
  if (duplicateEdge !== undefined) {
    throw new Error(
      `@samchon/graph: strict provider edge collides with another lane: ${edgeKey(duplicateEdge)}`,
    );
  }
  return {
    nodes: [...options.strictNodes, ...genericNodes],
    edges: [...options.strictEdges, ...genericEdges],
  };
}

function assertStrictSlice(
  nodes: readonly ISamchonGraphNode[],
  edges: readonly ISamchonGraphEdge[],
): void {
  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (nodeIds.has(node.id)) {
      throw new Error(
        `@samchon/graph: strict provider duplicated node: ${node.id}`,
      );
    }
    nodeIds.add(node.id);
  }
  const edgeKeys = new Set<string>();
  for (const edge of edges) {
    const key = edgeKey(edge);
    if (edgeKeys.has(key)) {
      throw new Error(
        `@samchon/graph: strict provider duplicated edge: ${key}`,
      );
    }
    edgeKeys.add(key);
    if (!nodeIds.has(edge.from) && edge.from.includes("#")) {
      throw new Error(
        `@samchon/graph: strict provider edge has unknown from endpoint: ${edge.from}`,
      );
    }
    if (!nodeIds.has(edge.to)) {
      throw new Error(
        `@samchon/graph: strict provider edge has unknown to endpoint: ${edge.to}`,
      );
    }
  }
}

function edgeKey(edge: ISamchonGraphEdge): string {
  return `${edge.kind}\0${edge.from}\0${edge.to}`;
}
