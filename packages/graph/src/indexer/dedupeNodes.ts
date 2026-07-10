import { ISamchonGraphNode } from "../structures";

export function dedupeNodes(nodes: ISamchonGraphNode[]): ISamchonGraphNode[] {
  const map = new Map<string, ISamchonGraphNode>();
  for (const node of nodes) map.set(node.id, node);
  return [...map.values()];
}
