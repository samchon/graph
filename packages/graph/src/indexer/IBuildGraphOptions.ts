import { GraphLanguage } from "../typings";

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
  /**
   * How long to wait for the FIRST `textDocument/references` request, which may
   * trigger the server to build its cross-file reference index lazily. Once that
   * one warmup request returns, later references are cache-fast and use the
   * normal `lspTimeoutMs`. A timeout here means the server cannot answer
   * references at all, so only structural edges are kept. Defaults to a patient
   * budget (slow servers like ruby-lsp need it); fast servers answer instantly
   * and never reach it.
   */
  lspWarmupTimeoutMs?: number;
  /**
   * Keep each language's LSP connection open after the build instead of
   * closing it. The caller becomes responsible for the returned sessions:
   * refresh them via `refreshLanguageSession` and close them when done, or
   * they leak. Only the resident MCP server path sets this; the one-shot
   * `dump` CLI command never does.
   */
  keepAlive?: boolean;
  /**
   * Command (and any leading arguments) used to bootstrap a missing
   * `compile_commands.json` for cpp/c projects that configure CMake.
   * Defaults to `["cmake"]`; overridable so tests can substitute a fake
   * binary instead of depending on a real cmake install.
   */
  cmakeCommand?: string[];
}
