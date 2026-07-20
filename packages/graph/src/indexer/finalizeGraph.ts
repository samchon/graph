import { ISamchonGraphEdge, ISamchonGraphNode } from "../structures";
import { assignSemanticIdentities } from "./assignSemanticIdentities";
import { exportEdges } from "./exportEdges";
import { markClosures } from "./markClosures";
import { markIgnored } from "./markIgnored";
import { normalizeGraphNodeKinds } from "./normalizeGraphNodeKinds";

/**
 * The facts the ranking leans on that no single-file pass can see: the `closure`
 * flag and the `exports` edges followed transitively through the project's
 * barrels (§4k), and the `ignored` flag the project itself already declared.
 *
 * Both indexers end here, so a static graph and a language-server graph carry
 * the same facts and the operations layer never has to ask which one built it.
 * It is idempotent: a hybrid dump merges a static slice that has already been
 * through it, and running it again marks the same closures, asks git the same
 * question, and derives the same edges (the caller dedupes).
 */
export function finalizeGraph(
  root: string,
  files: readonly string[],
  nodes: ISamchonGraphNode[],
  edges: ISamchonGraphEdge[],
): {
  nodes: ISamchonGraphNode[];
  edges: ISamchonGraphEdge[];
  warnings: string[];
} {
  normalizeGraphNodeKinds(nodes);
  markClosures(nodes);
  markIgnored(root, nodes);
  const finalizedEdges = [...edges, ...exportEdges(root, files, nodes)];
  const warnings: string[] = [];
  assignSemanticIdentities(nodes, finalizedEdges, warnings);
  return { nodes, edges: finalizedEdges, warnings };
}
