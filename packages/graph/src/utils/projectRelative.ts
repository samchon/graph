import { normalizePath } from "./normalizePath";
import { relativePath } from "./relativePath";

export function projectRelative(root: string, file: string): string {
  return normalizePath(relativePath(root, file));
}
