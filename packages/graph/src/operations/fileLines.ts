import path from "node:path";
import { readLines } from "../utils/fs";

/** Read a file's lines once, or undefined when it cannot be read. */
export function fileLines(
  project: string,
  file: string,
): string[] | undefined {
  if (file === "") return undefined;
  return readLines(path.join(project, file));
}
