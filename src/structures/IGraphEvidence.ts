export interface IGraphEvidence {
  file: string;
  startLine: number;
  startCol?: number;
  endLine?: number;
  endCol?: number;
  text?: string;
}
