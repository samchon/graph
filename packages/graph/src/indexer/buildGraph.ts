import { GraphMemory } from "../model/GraphMemory";
import { buildGraphDump } from "./buildGraphDump";
import { IBuildGraphOptions } from "./IBuildGraphOptions";

export async function buildGraph(
  options: IBuildGraphOptions = {},
): Promise<GraphMemory> {
  const dump = await buildGraphDump(options);
  return GraphMemory.from(dump);
}
