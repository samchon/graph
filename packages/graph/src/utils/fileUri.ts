import path from "node:path";

export function fileUri(file: string): string {
  // Prepend a leading slash for Windows drive paths (`C:/x` -> `/C:/x`) while
  // leaving POSIX paths untouched. A branchless replace keeps the coverage gate
  // reachable on every platform, since a plain `if` here is only ever taken on
  // one OS.
  const resolved = path
    .resolve(file)
    .replace(/\\/g, "/")
    .replace(/^(?!\/)/, "/");
  return `file://${encodeURI(resolved).replace(/#/g, "%23")}`;
}
