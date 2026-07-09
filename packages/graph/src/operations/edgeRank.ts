import { GraphEdgeKind } from "../typings";

export function edgeRank(kind: string): number {
  switch (kind satisfies string as GraphEdgeKind | string) {
    case "calls":
      return 0;
    case "instantiates":
      return 1;
    case "references":
    case "accesses":
      return 2;
    case "type_ref":
      return 3;
    case "extends":
    case "implements":
    case "overrides":
      return 4;
    case "tests":
      return 5;
    default:
      return 10;
  }
}
