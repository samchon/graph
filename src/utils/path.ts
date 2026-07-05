import path from "node:path";

export function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

export function relativePath(root: string, file: string): string {
  return normalizePath(path.relative(root, file));
}

export function dirname(file: string): string {
  const normalized = normalizePath(file);
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(0, slash) : ".";
}

export function basename(file: string): string {
  const normalized = normalizePath(file);
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

export function fileUri(file: string): string {
  let resolved = path.resolve(file).replace(/\\/g, "/");
  if (!resolved.startsWith("/")) resolved = `/${resolved}`;
  return `file://${encodeURI(resolved).replace(/#/g, "%23")}`;
}

export function fileFromUri(uri: string): string {
  if (!uri.startsWith("file://")) return uri;
  const decoded = decodeURI(uri.slice("file://".length));
  if (/^\/[A-Za-z]:/.test(decoded)) return decoded.slice(1).replace(/\//g, "\\");
  return decoded;
}

export function isSubPath(root: string, candidate: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
