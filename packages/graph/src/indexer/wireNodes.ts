import { ISamchonGraphDump, ISamchonGraphNode } from "../structures";
import { spanWithoutFile } from "./spanWithoutFile";

/**
 * Put the nodes on the wire: drop from each span the file the reader
 * reconstructs from the node's own `file` (§6b). An `implementation` span keeps
 * its file when it has a different one — that one is not derivable.
 */
export function wireNodes(
  nodes: readonly ISamchonGraphNode[],
): ISamchonGraphDump.INode[] {
  return nodes.map((node) => {
    const { evidence, implementation, ...rest } = node;
    return {
      ...rest,
      ...(evidence !== undefined
        ? { evidence: spanWithoutFile(evidence, node.file) }
        : {}),
      ...(implementation !== undefined
        ? { implementation: spanWithoutFile(implementation, node.file) }
        : {}),
    };
  });
}
