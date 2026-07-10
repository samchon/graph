import { GraphEdgeKind } from "../typings";

export function edgeRank(kind: string): number {
  switch (kind satisfies string as GraphEdgeKind | string) {
    case "calls":
      return 0;
    case "instantiates":
      return 1;
    case "references":
    case "accesses":
    case "renders":
      return 2;
    case "tests":
      return 3;
    case "overrides":
    case "decorates":
      return 4;
    case "extends":
    case "implements":
      return 5;
    case "type_ref":
      return 6;
    default:
      return 10;
  }
}
