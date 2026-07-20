import { ISamchonGraphNode } from "../structures";

/**
 * Normalize declaration kinds whose generic producer lacks member context
 * before identity or serialization observes them.
 */
export function normalizeGraphNodeKinds(
  nodes: readonly ISamchonGraphNode[],
): void {
  const byFileKey = new Map<string, ISamchonGraphNode>();
  for (const node of nodes) {
    if (!node.external && node.kind !== "file") {
      byFileKey.set(`${node.file}\0${keyOf(node)}`, node);
    }
  }
  for (const node of nodes) {
    if (node.kind !== "variable" || node.external) continue;
    const owner = ownerOf(node, byFileKey);
    if (owner?.kind === "class" || owner?.kind === "interface") {
      node.kind = "property";
    }
  }
}

function keyOf(node: ISamchonGraphNode): string {
  return node.qualifiedName ?? node.name;
}

function ownerOf(
  node: ISamchonGraphNode,
  byFileKey: ReadonlyMap<string, ISamchonGraphNode>,
): ISamchonGraphNode | undefined {
  const key = keyOf(node);
  const dot = key.lastIndexOf(".");
  if (dot < 0) return undefined;
  return byFileKey.get(`${node.file}\0${key.slice(0, dot)}`);
}
