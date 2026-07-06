import { readText } from "./readText";

export function readLines(file: string): string[] | undefined {
  return readText(file)?.split(/\r?\n/);
}
