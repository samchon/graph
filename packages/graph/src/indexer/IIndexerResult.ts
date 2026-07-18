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
   *
   * Only the lanes that read text themselves appear here: a bulk provider
   * publishes a digest manifest and never the bytes, so its files are absent.
   * Nothing is lost by that. The freshness hashes this feeds already skip every
   * bulk language — a compiler-owned session reports its own generation, which
   * is a better answer than re-hashing the disk behind its back — and the file
   * set the graph is finalized against comes from the session's manifest.
   */
  sources?: Map<string, string>;
}
