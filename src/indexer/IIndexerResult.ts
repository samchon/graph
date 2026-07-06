import { IGraphDump } from "../structures";

export interface IIndexerResult {
  dump: IGraphDump;
  warnings: string[];
}
