import { readText } from "../utils/fs";

/** First source whose current text differs from the exact text consumed. */
export function movedConsumedSource(
  sources: ReadonlyMap<string, string>,
): string | undefined {
  for (const [file, consumed] of sources) {
    if (readText(file) !== consumed) return file;
  }
  return undefined;
}
