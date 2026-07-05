import path from "node:path";

import typia from "typia";

import { GraphMemory } from "../model/GraphMemory";
import { IGraphDump } from "../structures";
import { buildLspGraph } from "./lspIndexer";
import { buildStaticGraph } from "./staticIndexer";
import { IBuildGraphOptions } from "./types";

export async function buildGraph(
  options: IBuildGraphOptions = {},
): Promise<GraphMemory> {
  const dump = await buildGraphDump(options);
  return GraphMemory.from(dump);
}

export async function buildGraphDump(
  options: IBuildGraphOptions = {},
): Promise<IGraphDump> {
  const normalized: IBuildGraphOptions = {
    ...options,
    cwd: path.resolve(options.cwd ?? process.cwd()),
    mode: options.mode ?? "auto",
  };
  if (normalized.mode === "static") {
    return validateDump(buildStaticGraph(normalized));
  }
  if (normalized.mode === "lsp") {
    return validateDump((await buildLspGraph(normalized)).dump);
  }
  const lsp = await buildLspGraph(normalized);
  if (lsp.dump.indexer === "static") return validateDump(lsp.dump);
  return validateDump(lsp.dump);
}

function validateDump(dump: IGraphDump): IGraphDump {
  return typia.assert<IGraphDump>(dump);
}
