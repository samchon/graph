import fs from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createResidentGraphSource } from "../indexer/createResidentGraphSource";
import { IBuildGraphOptions } from "../indexer/IBuildGraphOptions";
import { SamchonGraphMemory } from "../SamchonGraphMemory";
import { ISamchonGraphDump } from "../structures";
import { createServer } from "./createServer";

export async function startServer(
  options: IBuildGraphOptions & { version: string; graphFile?: string },
): Promise<void> {
  // A pre-built dump (`--graph-file`) serves immediately — the expensive index
  // was paid once, outside this process, the same way comparator tools pay
  // their `init`. It is a static snapshot with no live LSP connection behind
  // it, so it is read once and cached forever rather than watched for edits.
  //
  // Without `--graph-file`, the resident source keeps every language's LSP
  // connection open past the first build and re-scans only when a source
  // file's mtime has moved since the last check, reusing the warm connection
  // instead of restarting the language server (and paying its full cold
  // start, e.g. kotlin-language-server's Gradle sync) on every call.
  const source =
    options.graphFile !== undefined
      ? once(() => SamchonGraphMemory.from(
          JSON.parse(fs.readFileSync(options.graphFile!, "utf8")) as ISamchonGraphDump,
        ))
      : (() => {
          const resident = createResidentGraphSource(options);
          return async () => SamchonGraphMemory.from(await resident.load());
        })();
  const server = createServer(source, options.version);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Memoizes a zero-arg function's first resolved value; a rejected call is not
// cached so a transient failure can be retried on the next call.
function once<T>(fn: () => T): () => T {
  let value: T | undefined;
  let loaded = false;
  return () => {
    if (!loaded) {
      value = fn();
      loaded = true;
    }
    return value as T;
  };
}
