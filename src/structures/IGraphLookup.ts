import { GraphLanguage } from "./GraphLanguage";
import { GraphNodeKind } from "./GraphNodeKind";
import { IGraphDecorator } from "./IGraphDecorator";
import { IGraphNext } from "./IGraphNext";
import { IGraphOverview } from "./IGraphOverview";

export interface IGraphLookup {
  type: "lookup";
  hits: IGraphLookup.IHit[];
  unknown?: string[];
  next: IGraphNext;
  guide: string;
}

export namespace IGraphLookup {
  export interface IRequest {
    type: "lookup";
    query: string;
    language?: GraphLanguage;
    kind?: GraphNodeKind;
    limit?: number;
    includeExternal?: boolean;
  }

  export interface IHit extends IGraphOverview.INode {
    score: number;
    signature?: string;
    decorators?: IGraphDecorator[];
  }
}
