import { ISamchonGraphEdge } from "../structures";

export function dedupeEdges(edges: ISamchonGraphEdge[]): ISamchonGraphEdge[] {
  const map = new Map<string, ISamchonGraphEdge>();
  for (const edge of edges) map.set(
    `${edge.kind}\0${edge.from}\0${edge.to}`,
    edge,
  );
  return [...map.values()];
}
