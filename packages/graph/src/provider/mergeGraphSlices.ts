import { ISamchonGraphEdge, ISamchonGraphNode } from "../structures";
import { dedupeEdges } from "../indexer/dedupeEdges";
import { dedupeNodes } from "../indexer/dedupeNodes";
import { finalizeGraph } from "../indexer/finalizeGraph";
import {
  isSemanticGraphNodeId,
  validateSemanticGraphNode,
} from "./semanticIdentity";

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
}): {
  nodes: ISamchonGraphNode[];
  edges: ISamchonGraphEdge[];
  warnings: string[];
} {
  assertStrictSlice(options.strictNodes, options.strictEdges);
  const strictNodes = normalizeStrictNodes(options.strictNodes);
  const strictEdges = normalizeStrictEdges(options.strictEdges);
  const generic = finalizeGraph(
    options.root,
    options.files,
    options.genericNodes,
    options.genericEdges,
  );
  const warnings = [...generic.warnings];
  const genericNodes = dedupeNodes(generic.nodes, (id, count) =>
    warnings.push(
      `@samchon/graph: generic semantic declaration has ${count} locations; retaining canonical declaration and implementation spans: ${id}`,
    ),
  );
  const genericEdges = dedupeEdges(generic.edges);
  const nodeIds = new Set(strictNodes.map((node) => node.id));
  const duplicateNode = genericNodes.find((node) => nodeIds.has(node.id));
  if (duplicateNode !== undefined) {
    throw new Error(
      `@samchon/graph: strict provider node collides with another lane: ${duplicateNode.id}`,
    );
  }
  const edgeKeys = new Set(strictEdges.map(edgeKey));
  const duplicateEdge = genericEdges.find((edge) => edgeKeys.has(edgeKey(edge)));
  if (duplicateEdge !== undefined) {
    throw new Error(
      `@samchon/graph: strict provider edge collides with another lane: ${edgeKey(duplicateEdge)}`,
    );
  }
  return {
    nodes: [...strictNodes, ...genericNodes],
    edges: [...strictEdges, ...genericEdges],
    warnings,
  };
}

function normalizeStrictNodes(
  nodes: ISamchonGraphNode[],
): ISamchonGraphNode[] {
  const legacy = nodes.filter((node) => !isSemanticGraphNodeId(node.id));
  const semantic = nodes
    .filter((node) => isSemanticGraphNodeId(node.id))
    .sort((left, right) => compareText(left.id, right.id));
  return [...legacy, ...semantic];
}

function normalizeStrictEdges(
  edges: ISamchonGraphEdge[],
): ISamchonGraphEdge[] {
  const legacy: ISamchonGraphEdge[] = [];
  const semantic: ISamchonGraphEdge[] = [];
  for (const edge of edges) {
    (isSemanticGraphNodeId(edge.from) || isSemanticGraphNodeId(edge.to)
      ? semantic
      : legacy
    ).push(edge);
  }
  semantic.sort((left, right) =>
    compareText(edgeOrderKey(left), edgeOrderKey(right)),
  );
  return [...legacy, ...semantic];
}

function assertStrictSlice(
  nodes: readonly ISamchonGraphNode[],
  edges: readonly ISamchonGraphEdge[],
): void {
  const nodeIds = new Set<string>();
  for (const node of nodes) {
    validateSemanticGraphNode(node);
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

function edgeOrderKey(edge: ISamchonGraphEdge): string {
  return [
    edgeKey(edge),
    edge.evidence?.file ?? "",
    edge.evidence?.startLine ?? 0,
    edge.evidence?.startCol ?? 0,
  ].join("\0");
}

function compareText(left: string, right: string): number {
  /* c8 ignore next 2 -- sort keys include distinct node or edge identities. */
  return left < right ? -1 : left > right ? 1 : 0;
}
