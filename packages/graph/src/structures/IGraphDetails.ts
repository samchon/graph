import { IGraphDecorator } from "./IGraphDecorator";
import { IGraphDiagnostic } from "./IGraphDiagnostic";
import { IGraphEvidence } from "./IGraphEvidence";
import { IGraphNext } from "./IGraphNext";
import { IGraphOverview } from "./IGraphOverview";

export interface IGraphDetails {
  type: "details";
  nodes: IGraphDetails.INode[];
  unknown: string[];
  next: IGraphNext;
  guide: string;
}

export namespace IGraphDetails {
  export interface IRequest {
    type: "details";
    handles: string[];
    neighbors?: boolean;
    neighborLimit?: number;
    memberLimit?: number;
    dependencyLimit?: number;
    includeExternal?: boolean;
  }

  export interface INode extends IGraphOverview.INode {
    signature?: string;
    decorators?: IGraphDecorator[];
    implementation?: IGraphEvidence;
    members?: IMember[];
    calls?: IReference[];
    types?: IReference[];
    dependsOn?: IReference[];
    dependedOnBy?: IReference[];
    diagnostics?: IGraphDiagnostic[];
  }

  export interface IMember {
    name: string;
    kind: string;
    line?: number;
    signature?: string;
  }

  export interface IReference extends IGraphOverview.INode {
    relation: string;
    evidence?: IGraphEvidence;
  }
}
