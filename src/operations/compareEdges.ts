import { IGraphEdge } from "../structures";
import { edgeRank } from "./edgeRank";

export function compareEdges(a: IGraphEdge, b: IGraphEdge): number {
  return (
    edgeRank(a.kind) - edgeRank(b.kind) ||
    (a.evidence?.startLine ?? 999_999) - (b.evidence?.startLine ?? 999_999) ||
    (a.evidence?.startCol ?? 999) - (b.evidence?.startCol ?? 999)
  );
}
