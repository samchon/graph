import type {
  GraphEdgeKind,
  GraphLanguage,
  GraphNodeKind,
  SamchonGraphNodeModifier,
} from "../typings";

/** Source coordinates used by raw graph-sitter facts. */
export interface ISamchonGraphEvidence {
  file: string;
  startLine: number;
  startCol?: number;
  endLine?: number;
  endCol?: number;
}

/** A source decorator/annotation and its statically readable arguments. */
export interface ISamchonGraphDecorator {
  name: string;
  arguments: ISamchonGraphDecorator.IArgument[];
}
export namespace ISamchonGraphDecorator {
  export interface IArgument {
    literal?: string | number | boolean;
  }
}

/** Internal structural mirror of the raw node contract consumed by graph. */
export interface ISamchonGraphNode {
  id: string;
  kind: GraphNodeKind;
  language: GraphLanguage;
  name: string;
  qualifiedName?: string;
  file: string;
  external: boolean;
  ignored?: boolean;
  exported?: boolean;
  closure?: boolean;
  modifiers?: SamchonGraphNodeModifier[];
  decorators?: ISamchonGraphDecorator[];
  evidence?: ISamchonGraphEvidence;
  implementation?: ISamchonGraphEvidence;
}

/** Internal structural mirror of the raw edge contract consumed by graph. */
export interface ISamchonGraphEdge {
  from: string;
  to: string;
  kind: GraphEdgeKind;
  evidence?: ISamchonGraphEvidence;
}

export type IGraphSitterNode = ISamchonGraphNode;
export type IGraphSitterEdge = ISamchonGraphEdge;
export type IGraphSitterEvidence = ISamchonGraphEvidence;
export type IGraphSitterDecorator = ISamchonGraphDecorator;
