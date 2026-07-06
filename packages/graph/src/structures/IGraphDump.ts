import { GraphLanguage } from "./GraphLanguage";
import { IGraphDiagnostic } from "./IGraphDiagnostic";
import { IGraphEdge } from "./IGraphEdge";
import { IGraphNode } from "./IGraphNode";

export interface IGraphDump {
  project: string;
  languages: GraphLanguage[];
  generatedAt: string;
  indexer: "lsp" | "static" | "hybrid";
  nodes: IGraphNode[];
  edges: IGraphEdge[];
  diagnostics?: IGraphDiagnostic[];
  warnings?: string[];
}
