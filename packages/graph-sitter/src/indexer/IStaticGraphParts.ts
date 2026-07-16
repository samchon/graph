import type { ISamchonGraphEdge, ISamchonGraphNode } from "../structures";
import type { GraphLanguage } from "../typings";

/** Raw best-effort syntax facts, before @samchon/graph finalizes the graph. */
export interface IStaticGraphParts {
  root: string;
  files: string[];
  sources: Map<string, string>;
  languages: GraphLanguage[];
  nodes: ISamchonGraphNode[];
  edges: ISamchonGraphEdge[];
  warnings: string[];
}

export type IGraphSitterParts = IStaticGraphParts;
