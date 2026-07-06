import { normalizePath } from "./normalizePath";

export function dirname(file: string): string {
  const normalized = normalizePath(file);
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(0, slash) : ".";
}
