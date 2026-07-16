import { ISamchonGraphDump } from "../structures";
import { dedupeEdges } from "./dedupeEdges";
import { dedupeNodes } from "./dedupeNodes";
import { finalizeGraph } from "./finalizeGraph";
import { IBuildGraphOptions } from "./IBuildGraphOptions";
import { staticGraphParts } from "./staticGraphParts";
import { wireEdges } from "./wireEdges";
import { wireNodes } from "./wireNodes";

/**
 * The static graph as a dump: parse, derive the facts §4k asks of an indexer
 * with no type checker (the `closure` flag, and the `exports` edges followed
 * transitively through the project's barrels), then drop from every span the
 * file the reader can reconstruct (§6b).
 */
export function buildStaticGraph(
  options: IBuildGraphOptions = {},
): ISamchonGraphDump {
  const parts = staticGraphParts(options);
  const finalized = finalizeGraph(
    parts.root,
    [...parts.sources.keys()],
    parts.nodes,
    parts.edges,
  );
  return {
    project: parts.root,
    languages: parts.languages,
    indexer: "static",
    nodes: wireNodes(dedupeNodes(finalized.nodes)),
    edges: wireEdges(dedupeEdges(finalized.edges)),
    warnings: parts.warnings,
  };
}
