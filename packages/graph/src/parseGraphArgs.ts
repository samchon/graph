import { buildGraph } from "./indexer/buildGraph";
import { LANGUAGE_SPECS } from "./indexer/LANGUAGE_SPECS";
import { GraphLanguage } from "./typings";

export type IGraphArguments = Parameters<typeof buildGraph>[0] & {
  graphFile?: string;
};

/** Parse the graph arguments shared by the MCP, dump, and viewer launchers. */
export function parseGraphArgs(argv: readonly string[]): IGraphArguments {
  const options: IGraphArguments = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = (): string => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`Missing value for ${arg}`);
      return value;
    };
    if (arg === "--cwd") options.cwd = next();
    else if (arg.startsWith("--cwd=")) options.cwd = arg.slice("--cwd=".length);
    else if (arg === "--mode") options.mode = parseMode(next());
    else if (arg.startsWith("--mode="))
      options.mode = parseMode(arg.slice("--mode=".length));
    else if (arg === "--language")
      options.languages = [...(options.languages ?? []), parseLanguage(next())];
    else if (arg.startsWith("--language="))
      options.languages = [
        ...(options.languages ?? []),
        parseLanguage(arg.slice("--language=".length)),
      ];
    else if (arg === "--server") options.server = next();
    else if (arg.startsWith("--server="))
      options.server = arg.slice("--server=".length);
    else if (arg === "--server-arg")
      options.serverArgs = [...(options.serverArgs ?? []), next()];
    else if (arg.startsWith("--server-arg="))
      options.serverArgs = [
        ...(options.serverArgs ?? []),
        arg.slice("--server-arg=".length),
      ];
    else if (arg === "--lsp-concurrency")
      options.lspConcurrency = parseInteger(next());
    else if (arg.startsWith("--lsp-concurrency="))
      options.lspConcurrency = parseInteger(
        arg.slice("--lsp-concurrency=".length),
      );
    else if (arg === "--lsp-ready-quiet-ms")
      options.lspReadyQuietMs = parseInteger(next());
    else if (arg.startsWith("--lsp-ready-quiet-ms="))
      options.lspReadyQuietMs = parseInteger(
        arg.slice("--lsp-ready-quiet-ms=".length),
      );
    else if (arg === "--graph-file") options.graphFile = next();
    else if (arg.startsWith("--graph-file="))
      options.graphFile = arg.slice("--graph-file=".length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function parseMode(value: string): "auto" | "lsp" | "static" {
  if (value === "auto" || value === "lsp" || value === "static") return value;
  throw new Error(`Invalid --mode: ${value}`);
}

const ALLOWED_LANGUAGES = new Set<string>([
  ...LANGUAGE_SPECS.map((spec) => spec.language),
  "unknown",
]);

function parseLanguage(value: string): GraphLanguage {
  if (!ALLOWED_LANGUAGES.has(value))
    throw new Error(`Invalid --language: ${value}`);
  return value as GraphLanguage;
}

function parseInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1)
    throw new Error(`Expected positive integer, got: ${value}`);
  return Math.floor(parsed);
}
