import { createHash } from "node:crypto";
import fs from "node:fs";

/** First source whose current text differs from the exact text consumed. */
export function movedConsumedSource(
  sources: ReadonlyMap<string, string>,
  manifest?: ReadonlyMap<string, string>,
): string | undefined {
  for (const [file, consumed] of sources) {
    let current: Buffer;
    try {
      current = fs.readFileSync(file);
    } catch {
      return file;
    }
    if (current.toString("utf8") !== consumed) return file;
    if (
      manifest !== undefined &&
      manifest.get(file) !==
        createHash("sha256").update(current).digest("hex")
    ) {
      return file;
    }
  }
  return undefined;
}
