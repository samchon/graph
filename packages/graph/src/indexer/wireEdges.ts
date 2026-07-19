import { isSemanticGraphNodeId } from "../provider/semanticIdentity";
import {
  ISamchonGraphDump,
  ISamchonGraphEdge,
  ISamchonGraphNode,
} from "../structures";
import { fileOfNodeId } from "../utils/fileOfNodeId";
import { spanWithoutFile } from "./spanWithoutFile";

/**
 * Put the edges on the wire: drop from each span the file the reader
 * reconstructs from the edge's source node (§6b). Legacy ids still carry the
 * file in front of `#`; semantic ids are opaque and use the finalized node's
 * explicit `file` instead. Edges outnumber nodes several times over, so this is
 * where most of the 17% was.
 */
export function wireEdges(
  edges: readonly ISamchonGraphEdge[],
  nodes: readonly ISamchonGraphNode[],
): ISamchonGraphDump.IEdge[] {
  const files = new Map(nodes.map((node) => [node.id, node.file]));
  return edges.map((edge) => {
    const { evidence, ...rest } = edge;
    const file = files.get(edge.from) ?? legacyFileOfNodeId(edge.from);
    return {
      ...rest,
      ...(evidence !== undefined
        ? {
            evidence:
              file === undefined
                ? evidence
                : spanWithoutFile(evidence, file),
          }
        : {}),
    };
  });
}

/** A missing semantic source cannot be reverse-engineered from its opaque id. */
function legacyFileOfNodeId(id: string): string | undefined {
  return isSemanticGraphNodeId(id) ? undefined : fileOfNodeId(id);
}
