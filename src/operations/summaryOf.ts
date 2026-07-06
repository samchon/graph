import { IGraphNode, IGraphOverview } from "../structures";

export function summaryOf(node: IGraphNode): IGraphOverview.INode {
  const out: IGraphOverview.INode = {
    id: node.id,
    name: node.qualifiedName ?? node.name,
    kind: node.kind,
    language: node.language,
    file: node.file,
  };
  if (node.evidence?.startLine !== undefined) out.line = node.evidence.startLine;
  const span = node.implementation ?? node.evidence;
  if (span !== undefined) {
    out.sourceSpan = {
      file: span.file,
      startLine: span.startLine,
      ...(span.endLine !== undefined ? { endLine: span.endLine } : {}),
    };
  }
  return out;
}
