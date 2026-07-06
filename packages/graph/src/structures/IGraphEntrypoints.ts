import { GraphLanguage } from "./GraphLanguage";
import { IGraphNext } from "./IGraphNext";
import { IGraphOverview } from "./IGraphOverview";

export interface IGraphEntrypoints {
  type: "entrypoints";
  query: string;
  ranked: IGraphEntrypoints.IEntrypoint[];
  mentions: IGraphOverview.INode[];
  dependencyOrientation: string[];
  next: IGraphNext;
  guide: string;
}

export namespace IGraphEntrypoints {
  export interface IRequest {
    type: "entrypoints";
    query: string;
    language?: GraphLanguage;
    limit?: number;
  }

  export interface IEntrypoint extends IGraphOverview.INode {
    score: number;
    reason: string;
  }
}
