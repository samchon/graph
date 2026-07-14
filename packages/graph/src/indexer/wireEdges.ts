import { ISamchonGraphDump, ISamchonGraphEdge } from "../structures";
import { fileOfNodeId } from "../utils/fileOfNodeId";
import { spanWithoutFile } from "./spanWithoutFile";

/**
 * Put the edges on the wire: drop from each span the file the reader
 * reconstructs from the file the edge's `from` id already names (§6b). Edges
 * outnumber nodes several times over, so this is where most of the 17% was.
 */
export function wireEdges(
  edges: readonly ISamchonGraphEdge[],
): ISamchonGraphDump.IEdge[] {
  return edges.map((edge) => {
    const { evidence, ...rest } = edge;
    return {
      ...rest,
      ...(evidence !== undefined
        ? { evidence: spanWithoutFile(evidence, fileOfNodeId(edge.from)) }
        : {}),
    };
  });
}
