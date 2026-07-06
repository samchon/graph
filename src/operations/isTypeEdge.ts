export function isTypeEdge(kind: string): boolean {
  return (
    kind === "type_ref" ||
    kind === "extends" ||
    kind === "implements" ||
    kind === "overrides" ||
    kind === "decorates"
  );
}
