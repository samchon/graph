import { ISamchonGraphEdge, ISamchonGraphNode } from "../structures";
import { exportEdges } from "./exportEdges";
import { markClosures } from "./markClosures";

/**
 * The facts the ranking leans on that no single-file pass can see (§4k): the
 * `closure` flag, and the `exports` edges followed transitively through the
 * project's barrels.
 *
 * Both indexers end here, so a static graph and a language-server graph carry
 * the same two facts and the operations layer never has to ask which one built
 * it. It is idempotent: a hybrid dump merges a static slice that has already
 * been through it, and running it again marks the same closures and derives the
 * same edges (the caller dedupes).
 */
export function finalizeGraph(
  root: string,
  files: readonly string[],
  nodes: ISamchonGraphNode[],
  edges: ISamchonGraphEdge[],
): { nodes: ISamchonGraphNode[]; edges: ISamchonGraphEdge[] } {
  markClosures(nodes);
  return { nodes, edges: [...edges, ...exportEdges(root, files, nodes)] };
}
