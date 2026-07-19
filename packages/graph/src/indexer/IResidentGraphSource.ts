import { ISamchonGraphDump } from "../structures";
import { SamchonGraphSourceReader } from "../SamchonGraphSourceReader";

/**
 * A resident indexer: builds once, keeps every language's LSP connection open,
 * and on a later `load()` call re-scans only if a source file's *contents*
 * changed since the last snapshot -- reusing the live connections instead of
 * paying `initialize` again. This is what makes the MCP tool's own guidance
 * ("rebuild the graph after an edit") actually cheap for a server like
 * kotlin-language-server, whose Gradle project sync dominates a cold build far
 * more than the reference collection that follows it.
 *
 * Freshness is a content hash, never a timestamp (§1c). A same-tick, same-size
 * edit -- an editor writing a file twice inside one clock resolution, a script
 * rewriting a line to the same length -- leaves the mtime exactly where it was,
 * and a source that read the timestamp would then answer from code that no
 * longer exists while the result's audit swore it was current for "the snapshot
 * this call synced to".
 */
export interface IResidentGraphSource {
  /**
   * The graph for the current disk snapshot, refreshed only if it moved.
   * Calls are serialized so one live language-server session never receives
   * overlapping refreshes; a failed build does not prevent the next call from
   * retrying. Rejects after {@link close} begins.
   */
  load(): Promise<ISamchonGraphDump>;

  /** Source display reader belonging to the dump returned by the last load. */
  source(): SamchonGraphSourceReader | undefined;

  /**
   * End every language-server connection this source opened. Safe to call on a
   * source that never loaded -- an MCP server that exits before its first tool
   * call still closes, and a language server that outlives the server that
   * spawned it holds a whole project load resident behind a session nobody is
   * talking to. If a build is in flight, close waits for its session to become
   * available and disposes it before resolving.
   */
  close(): Promise<void>;
}
