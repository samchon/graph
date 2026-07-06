export function isStructural(kind: string): boolean {
  return kind === "contains" || kind === "exports" || kind === "imports";
}
