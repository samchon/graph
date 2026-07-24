import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { IBulkGraphSession } from "../provider/IBulkGraphSession";

/** Find a provider source that no longer belongs to the fenced generation. */
export function movedProviderSource(
  digests: ReadonlyMap<
    string,
    IBulkGraphSession.ISourceDigest
  > | undefined,
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): string | undefined {
  if (digests === undefined) return undefined;
  for (const [file, digest] of digests) {
    const expectedBefore = before.get(file);
    const expectedAfter = after.get(file);
    if (expectedBefore === undefined && expectedAfter === undefined) {
      if (file.startsWith("bundled:///")) continue;
      if (
        !path.isAbsolute(file) ||
        digest.diskDigest === "" ||
        digest.diskDigest !== diskDigest(file)
      ) {
        return `${file} does not bind the provider snapshot to the coordinator's input generation`;
      }
      continue;
    }
    if (
      digest.diskDigest === "" ||
      digest.diskDigest !== expectedBefore ||
      digest.diskDigest !== expectedAfter
    ) {
      return `${file} does not bind the provider snapshot to the coordinator's input generation`;
    }
  }
  return undefined;
}

function diskDigest(file: string): string {
  try {
    return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  } catch {
    return "";
  }
}
