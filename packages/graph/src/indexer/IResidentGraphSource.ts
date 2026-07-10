import { ISamchonGraphDump } from "../structures";

/**
 * A resident indexer: builds once, keeps every language's LSP connection
 * open, and on a later `load()` call re-scans only if a source file's mtime
 * moved since the last snapshot -- reusing the live connections instead of
 * paying `initialize` again. This is what makes the MCP tool's own guidance
 * ("rebuild the graph after an edit") actually cheap for a server like
 * kotlin-language-server, whose Gradle project sync dominates a cold build
 * far more than the reference collection that follows it.
 */
export interface IResidentGraphSource {
  load(): Promise<ISamchonGraphDump>;
  close(): Promise<void>;
}
