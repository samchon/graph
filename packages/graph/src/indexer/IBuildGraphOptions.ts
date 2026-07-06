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
}
