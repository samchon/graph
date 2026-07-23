import path from "node:path";
import { pathToFileURL } from "node:url";

export function fileUri(file: string): string {
  return pathToFileURL(path.resolve(file)).href;
}
