import { normalizePath } from "./normalizePath";

export function basename(file: string): string {
  const normalized = normalizePath(file);
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}
