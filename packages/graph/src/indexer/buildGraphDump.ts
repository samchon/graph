import { ISamchonGraphDump } from "../structures";
import { IBuildGraphOptions } from "./IBuildGraphOptions";
import { buildGraphResult } from "./buildGraphResult";

export async function buildGraphDump(
  options: IBuildGraphOptions = {},
): Promise<ISamchonGraphDump> {
  return (await buildGraphResult(options)).dump;
}
