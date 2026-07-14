import {
  ISamchonGraphDump,
  ISamchonGraphEdge,
  ISamchonGraphEvidence,
  ISamchonGraphNode,
  ISamchonGraphSpan,
} from "../structures";

/**
 * Drop from every span the file the reader can reconstruct (§6b).
 *
 * A node's declaration span is in the node's own `file`, and an edge's span is
 * in the file its `from` id names — the id is `path#Qualified.Name:kind`. Both
 * rode the wire a second and a third time, on every node and on every edge, and
 * edges outnumber nodes several times over: 17% of the document was a value the
 * reader already held. {@link SamchonGraphMemory} puts it back before anything
 * reads it, so nothing downstream sees a span without its file.
 *
 * An implementation span keeps its file: it genuinely can live in another file
 * from the declaration that owns it, so that one is not derivable.
 */
export function wireNodes(
  nodes: readonly ISamchonGraphNode[],
): ISamchonGraphDump.INode[] {
  return nodes.map((node) => {
    const { evidence, implementation, ...rest } = node;
    return {
      ...rest,
      ...(evidence !== undefined
        ? { evidence: spanWithout(evidence, node.file) }
        : {}),
      ...(implementation !== undefined
        ? { implementation: spanWithout(implementation, node.file) }
        : {}),
    };
  });
}

export function wireEdges(
  edges: readonly ISamchonGraphEdge[],
): ISamchonGraphDump.IEdge[] {
  return edges.map((edge) => {
    const { evidence, ...rest } = edge;
    return {
      ...rest,
      ...(evidence !== undefined
        ? { evidence: spanWithout(evidence, fileOfNodeId(edge.from)) }
        : {}),
    };
  });
}

/** The span, minus the file when it is the one the reader can already name. */
function spanWithout(
  evidence: ISamchonGraphEvidence,
  derivable: string,
): ISamchonGraphSpan {
  const { file, ...rest } = evidence;
  return file === derivable ? rest : { file, ...rest };
}

/**
 * The source file a node id names. An id is `path#Qualified.Name:kind`, and a
 * file node's id is the path itself.
 */
function fileOfNodeId(id: string): string {
  const hash = id.indexOf("#");
  return hash === -1 ? id : id.slice(0, hash);
}
