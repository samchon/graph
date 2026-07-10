import { ISamchonGraphDump } from "../structures";
import { GraphLanguage } from "../typings";
import { ILspSession } from "./ILspSession";

export interface IIndexerResult {
  dump: ISamchonGraphDump;
  warnings: string[];
  /** Present only when `options.keepAlive` was set: one live session per
   * language that produced real LSP data, for a resident graph to refresh
   * from later without paying `initialize` again. */
  sessions?: Map<GraphLanguage, ILspSession>;
}
