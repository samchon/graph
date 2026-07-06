import { IGraphEvidence } from "./IGraphEvidence";
import { IGraphNext } from "./IGraphNext";
import { IGraphOverview } from "./IGraphOverview";

export interface IGraphTrace {
  type: "trace";
  start?: IGraphTrace.INode;
  direction: string;
  hops: IGraphTrace.IHop[];
  reached: IGraphTrace.INode[];
  truncated: boolean;
  target?: IGraphTrace.INode;
  path?: IGraphTrace.INode[];
  steps?: string[];
  candidates?: IGraphTrace.INode[];
  next: IGraphNext;
  guide: string;
}

export namespace IGraphTrace {
  export interface IRequest {
    type: "trace";
    from: string;
    to?: string;
    direction?: "forward" | "reverse" | "impact";
    focus?: "all" | "execution" | "types";
    maxDepth?: number;
    maxNodes?: number;
    includeExternal?: boolean;
  }

  export interface IHop {
    from: string;
    to: string;
    kind: string;
    depth: number;
    evidence?: IGraphEvidence;
  }

  export interface INode extends IGraphOverview.INode {
    depth?: number;
    signature?: string;
    roles?: string[];
  }
}
