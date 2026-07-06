import { GraphLanguage } from "./GraphLanguage";
import { GraphNodeKind } from "./GraphNodeKind";
import { IGraphDecorator } from "./IGraphDecorator";
import { IGraphEvidence } from "./IGraphEvidence";

export interface IGraphNode {
  id: string;
  kind: GraphNodeKind;
  language: GraphLanguage;
  name: string;
  qualifiedName?: string;
  file: string;
  external: boolean;
  ignored?: boolean;
  exported?: boolean;
  signature?: string;
  modifiers?: string[];
  decorators?: IGraphDecorator[];
  evidence?: IGraphEvidence;
  implementation?: IGraphEvidence;
}
