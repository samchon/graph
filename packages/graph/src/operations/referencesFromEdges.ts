import { GraphMemory } from "../model/GraphMemory";
import { IGraphDetails, IGraphEdge } from "../structures";
import { compareEdges } from "./compareEdges";
import { isStructural } from "./isStructural";
import { publicEvidence } from "./publicEvidence";
import { summaryOf } from "./summaryOf";

export function referencesFromEdges(
  graph: GraphMemory,
  edges: readonly IGraphEdge[],
  end: "from" | "to",
  limit: number,
  includeExternal: boolean,
  kinds?: ReadonlySet<string>,
): IGraphDetails.IReference[] {
  const out: IGraphDetails.IReference[] = [];
  const seen = new Set<string>();
  for (const edge of [...edges].sort(compareEdges)) {
    if (kinds !== undefined && !kinds.has(edge.kind)) continue;
    if (isStructural(edge.kind)) continue;
    const node = graph.node(end === "from" ? edge.from : edge.to);
    if (node === undefined) continue;
    if (!includeExternal && node.external) continue;
    // One entry per node; edges are pre-sorted by compareEdges, so the first
    // (highest-ranked) relation to a node wins.
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    const ref: IGraphDetails.IReference = {
      ...summaryOf(node),
      relation: edge.kind,
    };
    if (edge.evidence !== undefined) ref.evidence = publicEvidence(edge.evidence);
    out.push(ref);
    if (out.length >= limit) break;
  }
  return out;
}
