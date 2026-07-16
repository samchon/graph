import { ISamchonGraphDump } from "../structures";
import { GraphLanguage } from "../typings";
import { IBulkGraphSession } from "../provider/IBulkGraphSession";
import { ILspSession } from "./ILspSession";

export interface IIndexerResult {
  dump: ISamchonGraphDump;
  warnings: string[];
  /** Present only when `options.keepAlive` was set: one live session per
   * language that produced real LSP data, for a resident graph to refresh
   * from later without paying `initialize` again. */
  sessions?: Map<GraphLanguage, ILspSession | IBulkGraphSession>;
  /**
   * Exact source text used to build the dump, keyed by absolute path.
   * Present for resident builds so freshness hashes describe the indexed
   * snapshot rather than a later disk state.
   */
  sources?: Map<string, string>;
}
