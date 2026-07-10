import { ISamchonGraphEvidence } from "./ISamchonGraphEvidence";
import { GraphEdgeKind } from "../typings/GraphEdgeKind";

/**
 * A directed relationship from one {@link ISamchonGraphNode} to another, both named
 * by `id`. The triple `(from, to, kind)` is unique; a repeated relationship
 * keeps the first source-order evidence.
 *
 * Every edge is resolved by the compiler, so there is no per-edge trust flag to
 * carry — the whole graph is checker-resolved fact.
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
