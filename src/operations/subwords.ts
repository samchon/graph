export function subwords(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9_$]+/)
    .map((word) => word.toLowerCase())
    .filter((word) => word.length > 0);
}
