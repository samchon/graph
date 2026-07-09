import { SamchonGraphMemory } from "../SamchonGraphMemory";
import { buildGraphDump } from "./buildGraphDump";
import { IBuildGraphOptions } from "./IBuildGraphOptions";

export async function buildGraph(
  options: IBuildGraphOptions = {},
): Promise<SamchonGraphMemory> {
  const dump = await buildGraphDump(options);
  return SamchonGraphMemory.from(dump);
}
