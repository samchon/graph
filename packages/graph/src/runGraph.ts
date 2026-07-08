import { buildGraph } from "./indexer/buildGraph";
import { buildGraphDump } from "./indexer/buildGraphDump";
import { LANGUAGE_SPECS } from "./indexer/LANGUAGE_SPECS";
import { GraphLanguage } from "./structures";
import { startServer } from "./mcp/startServer";
import packageJson from "../package.json";

const VERSION: string = packageJson.version;

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
    void startServer({ ...options, version: VERSION }).catch((error: Error) => {
      /* c8 ignore next 2 */
      writeError(error);
      process.exit(1);
    });
  } catch (error) {
    writeError(error as Error);
    return 1;
  }
}

async function runDump(argv: readonly string[]): Promise<void> {
  try {
    const dump = await buildGraphDump(parseArgs(argv));
    process.stdout.write(`${JSON.stringify(dump, null, 2)}\n`);
  } catch (error) {
    writeError(error as Error);
    process.exitCode = 1;
  }
}

function parseArgs(argv: readonly string[]) {
  const options: Parameters<typeof buildGraph>[0] & { graphFile?: string } = {};
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
      options.serverArgs = [...(options.serverArgs ?? []), next()];
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
    } else if (arg === "--lsp-reference-limit") {
      options.lspReferenceLimit = parseInteger(next());
    } else if (arg.startsWith("--lsp-reference-limit=")) {
      options.lspReferenceLimit = parseInteger(arg.slice("--lsp-reference-limit=".length));
    } else if (arg === "--lsp-concurrency") {
      options.lspConcurrency = parseInteger(next());
    } else if (arg.startsWith("--lsp-concurrency=")) {
      options.lspConcurrency = parseInteger(arg.slice("--lsp-concurrency=".length));
    } else if (arg === "--graph-file") {
      options.graphFile = next();
    } else if (arg.startsWith("--graph-file=")) {
      options.graphFile = arg.slice("--graph-file=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
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
  if (!ALLOWED_LANGUAGES.has(value)) throw new Error(`Invalid --language: ${value}`);
  return value as GraphLanguage;
}

function parseInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`Expected positive integer, got: ${value}`);
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
  --lsp-reference-limit N   Reference targets to collect edges for.
  --lsp-concurrency N       Concurrent reference requests.
  --graph-file PATH         Serve a pre-built dump instead of indexing.
`;
}

function writeError(error: Error): void {
  process.stderr.write(`@samchon/graph: ${error.message}\n`);
}
