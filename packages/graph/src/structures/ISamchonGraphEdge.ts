import { ISamchonGraphEvidence } from "./ISamchonGraphEvidence";
import { GraphEdgeKind } from "../typings/GraphEdgeKind";

/**
 * A directed relationship between two {@link ISamchonGraphNode}s, both named by
 * `id`. The triple `(from, to, kind)` is unique; a repeat keeps the first
 * source-order evidence. Every edge is compiler-resolved, so there is no
 * per-edge trust flag: the whole graph is checker-resolved fact.
 */
export interface ISamchonGraphEdge {
  /** Node id the relationship originates from. */
  from: string;

  /** Node id the relationship points to. */
  to: string;

  /** The relationship kind. */
  kind: GraphEdgeKind;

  /** The source expression that produced the edge, for display and expansion. */
  evidence?: ISamchonGraphEvidence;
}
