import { GraphLanguage, IGraphDump } from "../structures";

export interface IBuildGraphOptions {
  cwd?: string;
  mode?: "auto" | "lsp" | "static";
  languages?: GraphLanguage[];
  server?: string;
  serverArgs?: string[];
  maxFiles?: number;
  lspReferenceLimit?: number;
  lspTimeoutMs?: number;
}

export interface IIndexerResult {
  dump: IGraphDump;
  warnings: string[];
}
