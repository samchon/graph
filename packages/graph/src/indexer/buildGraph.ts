import { SamchonGraphMemory } from "../SamchonGraphMemory";
import { SamchonGraphSourceReader } from "../SamchonGraphSourceReader";
import { buildGraphResult } from "./buildGraphDump";
import { IBuildGraphOptions } from "./IBuildGraphOptions";

export async function buildGraph(
  options: IBuildGraphOptions = {},
): Promise<SamchonGraphMemory> {
  const result = await buildGraphResult(options);
  return SamchonGraphMemory.from(
    result.dump,
    result.source ?? SamchonGraphSourceReader.none(result.dump.project),
  );
}
