import { SamchonGraphSourceReader } from "../SamchonGraphSourceReader";
import { ISamchonGraphDump } from "../structures";
import { dedupeEdges } from "./dedupeEdges";
import { dedupeNodes } from "./dedupeNodes";
import { finalizeGraph } from "./finalizeGraph";
import { IBuildGraphOptions } from "./IBuildGraphOptions";
import { IIndexerResult } from "./IIndexerResult";
import { staticGraphParts } from "./staticGraphParts";
import { wireEdges } from "./wireEdges";
import { wireNodes } from "./wireNodes";

/** Build one static dump together with the exact source bytes it consumed. */
export function buildStaticGraphResult(
  options: IBuildGraphOptions = {},
): IIndexerResult {
  const parts = staticGraphParts(options);
  const finalized = finalizeGraph(
    parts.root,
    [...parts.sources.keys()],
    parts.nodes,
    parts.edges,
  );
  const dump: ISamchonGraphDump = {
    project: parts.root,
    languages: parts.languages,
    indexer: "static",
    nodes: wireNodes(dedupeNodes(finalized.nodes)),
    edges: wireEdges(dedupeEdges(finalized.edges)),
    warnings: parts.warnings,
  };
  return {
    dump,
    warnings: parts.warnings,
    sources: new Map(parts.sources),
    source: new SamchonGraphSourceReader(parts.root, {
      texts: parts.sources,
    }),
  };
}
