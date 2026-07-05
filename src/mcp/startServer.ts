import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { buildGraph } from "../indexer/buildGraph";
import { IBuildGraphOptions } from "../indexer/types";
import { createServer } from "./createServer";

export async function startServer(
  options: IBuildGraphOptions & { version: string },
): Promise<void> {
  const server = createServer(() => buildGraph(options), options.version);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
