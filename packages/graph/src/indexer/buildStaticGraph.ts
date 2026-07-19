import { ISamchonGraphDump } from "../structures";
import { buildStaticGraphResult } from "./buildStaticGraphResult";
import { IBuildGraphOptions } from "./IBuildGraphOptions";

/**
 * The static graph as a dump: parse, derive the facts §4k asks of an indexer
 * with no type checker (the `closure` flag, and the `exports` edges followed
 * transitively through the project's barrels), then drop from every span the
 * file the reader can reconstruct (§6b).
 */
export function buildStaticGraph(
  options: IBuildGraphOptions = {},
): ISamchonGraphDump {
  return buildStaticGraphResult(options).dump;
}
