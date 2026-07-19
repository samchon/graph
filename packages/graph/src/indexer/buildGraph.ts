import { SamchonGraphMemory } from "../SamchonGraphMemory";
import { SamchonGraphSourceReader } from "../SamchonGraphSourceReader";
import { buildGraphResult } from "./buildGraphResult";
import { IBuildGraphOptions } from "./IBuildGraphOptions";

export async function buildGraph(
  options: IBuildGraphOptions = {},
): Promise<SamchonGraphMemory> {
  const result = await buildGraphResult(options);
  return SamchonGraphMemory.from(
    result.dump,
    /* c8 ignore next -- both concrete indexer result builders attach a reader. */
    result.source ?? SamchonGraphSourceReader.none(result.dump.project),
  );
}
