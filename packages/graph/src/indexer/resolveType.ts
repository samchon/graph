import { IGraphNode } from "../structures";

export function resolveType(
  name: string,
  source: IGraphNode,
  byName: Map<string, IGraphNode[]>,
): IGraphNode | undefined {
  const candidates = byName.get(name.split(".").pop()!);
  if (candidates === undefined) return undefined;
  return (
    candidates.find((node) => node.id !== source.id && node.file === source.file) ??
    candidates.find((node) => node.id !== source.id)
  );
}
