import { IRange } from "./IRange";

export interface IDiagnostic {
  range: IRange;
  severity?: number;
  code?: string | number;
  source?: string;
  message: string;
}
