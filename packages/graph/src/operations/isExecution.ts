export function isExecution(kind: string): boolean {
  return (
    kind === "calls" ||
    kind === "instantiates" ||
    kind === "accesses" ||
    kind === "renders"
  );
}
