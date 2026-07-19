import { LspClient } from "../lsp";
import { ISamchonGraphDiagnostic } from "../structures";
import { GraphLanguage } from "../typings";

/**
 * A live LSP connection for one language, kept open past the initial build so
 * a resident graph can refresh from it later without paying `initialize`
 * again. `opened` mirrors the server's own open-document set: the absolute
 * path, last-known text, and protocol version of every file this session has
 * `didOpen`'d, keyed by project-relative path. A refresh can therefore diff
 * against it, advance `didChange` versions independently of wall-clock time,
 * and send lifecycle notifications only for what actually moved.
 */
export interface ILspSession {
  client: LspClient;
  root: string;
  language: GraphLanguage;
  opened: Map<string, { abs: string; text: string; version: number }>;

  /**
   * Monotonic generation of indexing progress observed from this server.
   * Callers take a generation before an operation that can start lazy work,
   * then pass it to `waitForReady` before trusting that operation's answer.
   */
  progressVersion?(): number;

  /**
   * Wait until progress newer than `since` settles. `allowStart` also gives a
   * server that has not emitted progress yet one quiet window to begin; this
   * is used after `didOpen`, while lazy reference warmups use `false` and only
   * wait when that request actually triggered progress.
   */
  waitForReady?(
    since: number,
    allowStart: boolean,
    signal?: AbortSignal,
  ): Promise<void>;

  /**
   * What the server currently says about each open document, keyed by
   * project-relative path.
   *
   * A map, not a log. `textDocument/publishDiagnostics` is a *replacement* for
   * the document it names — that is what the protocol says the notification
   * means — so a session that appended every notification to one array kept a
   * deleted file's errors forever and duplicated a re-analysed file's on every
   * refresh. The dump would then be a function of the session's edit history
   * rather than of the source on disk, which is exactly the property §6a says a
   * graph must have before it can be cached, diffed, or trusted.
   */
  diagnostics: Map<string, ISamchonGraphDiagnostic[]>;
}
