import { ISamchonGraphEdge, ISamchonGraphEvidence } from "../structures";

/** Source text is an internal alias hint, not part of the MCP evidence object. */
export function edgeEvidenceTextOf(edge: ISamchonGraphEdge): string | undefined {
  const text = (
    edge.evidence as (ISamchonGraphEvidence & { text?: string }) | undefined
  )?.text;
  return typeof text === "string" && text.length > 0 ? text : undefined;
}
