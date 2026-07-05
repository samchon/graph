import { buildGraph, buildGraphDump } from "./indexer/buildGraph";
import { GraphLanguage } from "./structures";
import { startServer } from "./mcp/startServer";

export * from "./application";
export * from "./indexer/buildGraph";
export * from "./indexer/languages";
export * from "./indexer/types";
export * from "./model/GraphMemory";
export * from "./structures";

const VERSION: string = (require("../package.json") as { version: string }).version;

export function runGraph(argv: readonly string[] = process.argv.slice(2)): number | void {
  try {
    if (argv[0] === "dump") {
      void runDump(argv.slice(1));
      return;
    }
    if (argv[0] === "help" || argv[0] === "--help" || argv[0] === "-h") {
      process.stdout.write(helpText());
      return 0;
    }

    const options = parseArgs(argv);
    void startServer({ ...options, version: VERSION }).catch((error: unknown) => {
      writeError(error);
      process.exit(1);
    });
  } catch (error) {
    writeError(error);
    return 1;
  }
}

async function runDump(argv: readonly string[]): Promise<void> {
  try {
    const dump = await buildGraphDump(parseArgs(argv));
    process.stdout.write(`${JSON.stringify(dump, null, 2)}\n`);
  } catch (error) {
    writeError(error);
    process.exitCode = 1;
  }
}

function parseArgs(argv: readonly string[]) {
  const options: Parameters<typeof buildGraph>[0] = {};
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
    else if (arg.startsWith("--mode=")) options.mode = parseMode(arg.slice("--mode=".length));
    else if (arg === "--language") options.languages = [...(options.languages ?? []), parseLanguage(next())];
    else if (arg.startsWith("--language=")) {
      options.languages = [
        ...(options.languages ?? []),
        parseLanguage(arg.slice("--language=".length)),
      ];
    } else if (arg === "--server") options.server = next();
    else if (arg.startsWith("--server=")) options.server = arg.slice("--server=".length);
    else if (arg === "--server-arg") {
      options.serverArgs = [...(options.serverArgs ?? []), next() ?? ""];
    } else if (arg.startsWith("--server-arg=")) {
      options.serverArgs = [
        ...(options.serverArgs ?? []),
        arg.slice("--server-arg=".length),
      ];
    } else if (arg === "--max-files") options.maxFiles = parseInteger(next());
    else if (arg.startsWith("--max-files=")) {
      options.maxFiles = parseInteger(arg.slice("--max-files=".length));
    } else if (arg === "--lsp-timeout-ms") {
      options.lspTimeoutMs = parseInteger(next());
    } else if (arg.startsWith("--lsp-timeout-ms=")) {
      options.lspTimeoutMs = parseInteger(arg.slice("--lsp-timeout-ms=".length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function parseMode(value: string | undefined): "auto" | "lsp" | "static" {
  if (value === "auto" || value === "lsp" || value === "static") return value;
  throw new Error(`Invalid --mode: ${value ?? ""}`);
}

function parseLanguage(value: string | undefined): GraphLanguage {
  const language = value ?? "";
  const allowed = new Set([
    "typescript",
    "javascript",
    "go",
    "rust",
    "cpp",
    "c",
    "java",
    "csharp",
    "kotlin",
    "swift",
    "scala",
    "zig",
    "unknown",
  ]);
  if (!allowed.has(language)) throw new Error(`Invalid --language: ${language}`);
  return language as GraphLanguage;
}

function parseInteger(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`Expected positive integer, got: ${value ?? ""}`);
  }
  return Math.floor(parsed);
}

function helpText(): string {
  return `@samchon/graph

Usage:
  samchon-graph [--cwd DIR] [--mode auto|lsp|static] [--language LANG]
  samchon-graph dump [same options]

Options:
  --server CMD              Override the language server command.
  --server-arg ARG          Add one language server argument.
  --max-files N             Cap source files indexed.
  --lsp-timeout-ms N        Per-request LSP timeout.
`;
}

function writeError(error: unknown): void {
  process.stderr.write(
    `@samchon/graph: ${error instanceof Error ? error.message : String(error)}\n`,
  );
}
