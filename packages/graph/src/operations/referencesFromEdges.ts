import { SamchonGraphMemory } from "../SamchonGraphMemory";
import { ISamchonGraphDetails, ISamchonGraphEdge } from "../structures";
import { accessAliasesFor } from "./accessAliasesFor";
import { compareEdges } from "./compareEdges";
import { edgeEvidenceTextOf } from "./edgeEvidenceTextOf";
import { isStructural } from "./isStructural";
import { publicEvidence } from "./publicEvidence";
import { summaryOf } from "./summaryOf";

export function referencesFromEdges(
  graph: SamchonGraphMemory,
  edges: readonly ISamchonGraphEdge[],
  end: "from" | "to",
  limit: number,
  includeExternal: boolean,
  kinds?: ReadonlySet<string>,
): ISamchonGraphDetails.IReference[] {
  const out: ISamchonGraphDetails.IReference[] = [];
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
    const ref: ISamchonGraphDetails.IReference = {
      ...summaryOf(node),
      relation: edge.kind,
    };
    if (edge.evidence !== undefined) ref.evidence = publicEvidence(
      edge.evidence,
    );
    const aliases = accessAliasesFor(node, edgeEvidenceTextOf(edge));
    if (aliases !== undefined) ref.aliases = aliases;
    out.push(ref);
    if (out.length >= limit) break;
  }
  return out;
}
