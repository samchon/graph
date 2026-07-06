import { GraphLanguage } from "./GraphLanguage";
import { IGraphDiagnostic } from "./IGraphDiagnostic";
import { IGraphEntrypoints } from "./IGraphEntrypoints";
import { IGraphNext } from "./IGraphNext";
import { IGraphOverview } from "./IGraphOverview";

export interface IGraphTour {
  type: "tour";
  question?: string;
  entrypoints: IGraphEntrypoints.IEntrypoint[];
  primaryFlow: string[];
  nearbyPaths: IGraphOverview.INode[];
  testAnchors: IGraphOverview.INode[];
  answerAnchors: IGraphOverview.INode[];
  diagnostics?: IGraphDiagnostic[];
  next: IGraphNext;
  guide: string;
}

export namespace IGraphTour {
  export interface IRequest {
    type: "tour";
    question?: string;
    language?: GraphLanguage;
    limit?: number;
  }
}
