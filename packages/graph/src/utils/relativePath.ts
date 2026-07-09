import path from "node:path";
import { normalizePath } from "./normalizePath";

export function relativePath(root: string, file: string): string {
  return normalizePath(path.relative(root, file));
}
