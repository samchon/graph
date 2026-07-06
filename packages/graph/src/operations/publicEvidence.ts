import { IGraphEvidence } from "../structures";

export function publicEvidence(evidence: IGraphEvidence): IGraphEvidence {
  return {
    file: evidence.file,
    startLine: evidence.startLine,
    ...(evidence.startCol !== undefined ? { startCol: evidence.startCol } : {}),
    ...(evidence.endLine !== undefined ? { endLine: evidence.endLine } : {}),
    ...(evidence.endCol !== undefined ? { endCol: evidence.endCol } : {}),
  };
}
