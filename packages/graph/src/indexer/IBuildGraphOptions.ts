import { GraphLanguage } from "../structures";

export interface IBuildGraphOptions {
  cwd?: string;
  mode?: "auto" | "lsp" | "static";
  languages?: GraphLanguage[];
  server?: string;
  serverArgs?: string[];
  initializationOptions?: unknown;
  maxFiles?: number;
  lspReferenceLimit?: number;
  lspTimeoutMs?: number;
  /**
   * How many `textDocument/references` requests to keep in flight at once.
   * Reference collection dominates indexing time on large repositories, and the
   * requests are independent, so they are issued concurrently up to this bound.
   */
  lspConcurrency?: number;
  /**
   * Maximum time to wait for a language server to finish its initial indexing
   * (reported through `$/progress`) before collecting references. Servers such
   * as rust-analyzer, clangd, and jdtls answer reference requests with nothing
   * until indexing completes, so skipping this wait yields zero edges.
   */
  lspReadyTimeoutMs?: number;
  /**
   * How long the server must stay silent on `$/progress` before its initial
   * indexing is treated as settled. Also bounds the wait for servers that never
   * report progress at all.
   */
  lspReadyQuietMs?: number;
}
