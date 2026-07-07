import { IGraphEdge, IGraphNode } from "../structures";

// Given a graph that already carries `contains` (owner -> member) and
// `extends`/`implements` (subtype -> supertype) edges, link a method to the
// supertype method it overrides: a same-named method reachable on a supertype.
export function overrideEdges(
  nodes: readonly IGraphNode[],
  edges: readonly IGraphEdge[],
): IGraphEdge[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const methodsByOwner = new Map<string, Map<string, IGraphNode>>();
  for (const edge of edges) {
    if (edge.kind !== "contains") continue;
    const member = byId.get(edge.to);
    if (member === undefined || member.kind !== "method") continue;
    let methods = methodsByOwner.get(edge.from);
    if (methods === undefined) {
      methods = new Map();
      methodsByOwner.set(edge.from, methods);
    }
    methods.set(member.name, member);
  }

  const out: IGraphEdge[] = [];
  for (const edge of edges) {
    if (edge.kind !== "extends" && edge.kind !== "implements") continue;
    const subMethods = methodsByOwner.get(edge.from);
    const superMethods = methodsByOwner.get(edge.to);
    if (subMethods === undefined || superMethods === undefined) continue;
    for (const [name, subMethod] of subMethods) {
      const superMethod = superMethods.get(name);
      if (superMethod === undefined) continue;
      out.push({
        from: subMethod.id,
        to: superMethod.id,
        kind: "overrides",
        evidence: subMethod.evidence,
      });
    }
  }
  return out;
}
