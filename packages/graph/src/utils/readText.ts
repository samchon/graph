import fs from "node:fs";

export function readText(file: string): string | undefined {
  try {
    // Strip a UTF-8 BOM (U+FEFF) so it does not offset the first line's columns.
    return fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  } catch {
    return undefined;
  }
}
