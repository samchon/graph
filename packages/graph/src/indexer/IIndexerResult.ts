import { ISamchonGraphDump } from "../structures";

export interface IIndexerResult {
  dump: ISamchonGraphDump;
  warnings: string[];
}
