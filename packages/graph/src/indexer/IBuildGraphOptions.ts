import { GraphLanguage } from "../typings";

export interface IBuildGraphOptions {
  cwd?: string;
  mode?: "auto" | "lsp" | "static";
  languages?: GraphLanguage[];
  server?: string;
  serverArgs?: string[];
  initializationOptions?: unknown;
  /**
   * How many `textDocument/references` requests to keep in flight at once.
   * Reference collection dominates indexing time on large repositories, and the
   * requests are independent, so they are issued concurrently up to this bound.
   * This is a concurrency lane count, not a cap on how many symbols are
   * resolved — every symbol's references are always collected.
   */
  lspConcurrency?: number;
  /**
   * How long the server must stay silent on `$/progress` before its initial
   * indexing is treated as settled. This is a quiet-detection threshold, not a
   * ceiling: a server that keeps reporting progress is still indexing and is
   * waited out with no overall time limit.
   */
  lspReadyQuietMs?: number;
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
  /**
   * Command (and any leading arguments) used to run `pub get` for dart
   * packages missing a resolved `.dart_tool/package_config.json`. Defaults
   * to `["dart"]`; overridable so tests can substitute a fake binary instead
   * of depending on a real dart install or network access.
   */
  pubCommand?: string[];
}
