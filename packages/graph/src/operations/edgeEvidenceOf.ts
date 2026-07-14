import { ISamchonGraphEdge, ISamchonGraphEvidence } from "../structures";
import { publicEvidence } from "./publicEvidence";

/** Relationship evidence as public coordinates, omitted when absent. */
export function edgeEvidenceOf(
  edge: ISamchonGraphEdge,
): ISamchonGraphEvidence | undefined {
  return edge.evidence === undefined
    ? undefined
    : publicEvidence(edge.evidence);
}
