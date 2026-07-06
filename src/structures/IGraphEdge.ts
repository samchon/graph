import { GraphEdgeKind } from "./GraphEdgeKind";
import { IGraphEvidence } from "./IGraphEvidence";

export interface IGraphEdge {
  from: string;
  to: string;
  kind: GraphEdgeKind;
  evidence?: IGraphEvidence;
}
