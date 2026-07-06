import { IGraphEvidence } from "./IGraphEvidence";

export interface IGraphDecorator {
  name: string;
  arguments?: string[];
  evidence?: IGraphEvidence;
}
