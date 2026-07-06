import { IGraphEvidence } from "./IGraphEvidence";

export interface IGraphDiagnostic {
  file: string;
  message: string;
  severity: "error" | "warning" | "information" | "hint";
  source?: string;
  code?: string | number;
  evidence?: IGraphEvidence;
}
