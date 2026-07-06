import { IRange } from "./IRange";

export interface IDocumentSymbol {
  name: string;
  detail?: string;
  kind: number;
  range: IRange;
  selectionRange: IRange;
  children?: IDocumentSymbol[];
}
