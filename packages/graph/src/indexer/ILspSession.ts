import { LspClient } from "../lsp";
import { ISamchonGraphDiagnostic } from "../structures";
import { GraphLanguage } from "../typings";

/**
 * A live LSP connection for one language, kept open past the initial build so
 * a resident graph can refresh from it later without paying `initialize`
 * again. `opened` mirrors the server's own open-document set: the absolute
 * path and last-known text of every file this session has `didOpen`'d, keyed
 * by project-relative path, so a refresh can diff against it and send
 * `didChange`/`didOpen`/`didClose` only for what actually moved.
 */
export interface ILspSession {
  client: LspClient;
  root: string;
  language: GraphLanguage;
  opened: Map<string, { abs: string; text: string }>;
  diagnostics: ISamchonGraphDiagnostic[];
}
