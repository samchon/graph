import { ISamchonGraphNode, ISamchonGraphOverview } from "../structures";

export function summaryOf(node: ISamchonGraphNode): ISamchonGraphOverview.INode {
  const out: ISamchonGraphOverview.INode = {
    id: node.id,
    name: node.qualifiedName ?? node.name,
    kind: node.kind,
    file: node.file,
  };
  if (node.evidence?.startLine !== undefined) out.line = node.evidence.startLine;
  return out;
}
