import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import fs from "node:fs";

import { buildGraph } from "../indexer/buildGraph";
import { IBuildGraphOptions } from "../indexer/IBuildGraphOptions";
import { GraphMemory } from "../model/GraphMemory";
import { IGraphDump } from "../structures";
import { createServer } from "./createServer";

export async function startServer(
  options: IBuildGraphOptions & { version: string; graphFile?: string },
): Promise<void> {
  // A pre-built dump (`--graph-file`) serves immediately — the expensive index
  // was paid once, outside this process, the same way comparator tools pay
  // their `init`. Without it the resident graph builds lazily on first use.
  const source =
    options.graphFile !== undefined
      ? () => GraphMemory.from(JSON.parse(fs.readFileSync(options.graphFile!, "utf8")) as IGraphDump)
      : () => buildGraph(options);
  const server = createServer(source, options.version);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
