import { GraphMemory } from "../model/GraphMemory";
import { IGraphNode } from "../structures";

export function resolveHandle(
  graph: GraphMemory,
  handle: string,
): { node?: IGraphNode; candidates?: IGraphNode[] } {
  const trimmed = handle.trim();
  if (trimmed === "") return {};
  const exact = graph.node(trimmed);
  if (exact !== undefined) return { node: exact };
  const symbolMatches = graph.symbols(trimmed);
  if (symbolMatches.length === 1) return { node: symbolMatches[0] };
  if (symbolMatches.length > 1) return { candidates: symbolMatches.slice(0, 8) };
  const lowered = trimmed.toLowerCase();
  const fuzzy = graph.nodes
    .filter(
      (node) =>
        node.kind !== "file" &&
        ((node.qualifiedName ?? node.name).toLowerCase().endsWith(lowered) ||
          node.file.toLowerCase().endsWith(lowered)),
    )
    .slice(0, 8);
  if (fuzzy.length === 1) return { node: fuzzy[0] };
  if (fuzzy.length > 1) return { candidates: fuzzy };
  return {};
}
