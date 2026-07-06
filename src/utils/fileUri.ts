import path from "node:path";

export function fileUri(file: string): string {
  let resolved = path.resolve(file).replace(/\\/g, "/");
  if (!resolved.startsWith("/")) resolved = `/${resolved}`;
  return `file://${encodeURI(resolved).replace(/#/g, "%23")}`;
}
