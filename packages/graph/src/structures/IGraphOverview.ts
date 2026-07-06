import { GraphLanguage } from "./GraphLanguage";
import { IGraphDiagnostic } from "./IGraphDiagnostic";
import { IGraphEvidence } from "./IGraphEvidence";
import { IGraphNext } from "./IGraphNext";

export interface IGraphOverview {
  type: "overview";
  project: string;
  languages: GraphLanguage[];
  counts: IGraphOverview.ICounts;
  layers?: IGraphOverview.ILayer[];
  hotspots?: IGraphOverview.IHotspot[];
  publicApi?: IGraphOverview.IPublicApi[];
  diagnostics?: IGraphDiagnostic[];
  next: IGraphNext;
  guide: string;
}

export namespace IGraphOverview {
  export interface IRequest {
    type: "overview";
    aspect?: "all" | "layers" | "hotspots" | "publicApi" | "diagnostics";
  }

  export interface ICounts {
    files: number;
    nodes: number;
    edges: number;
    byKind: Record<string, number>;
    byLanguage: Record<string, number>;
  }

  export interface ILayer {
    dir: string;
    files: number;
    exported: number;
    languages: GraphLanguage[];
  }

  export interface INode {
    id: string;
    name: string;
    kind: string;
    language: GraphLanguage;
    file: string;
    line?: number;
    sourceSpan?: Pick<IGraphEvidence, "file" | "startLine" | "endLine">;
  }

  export interface IHotspot extends INode {
    fanIn: number;
    fanOut: number;
  }

  export type IPublicApi = INode;
}
