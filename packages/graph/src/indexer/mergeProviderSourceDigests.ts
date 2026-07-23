import path from "node:path";

import { IBulkGraphSession } from "../provider/IBulkGraphSession";

/**
 * Merge one strict manifest without letting a later provider hide a conflict.
 */
export function mergeProviderSourceDigests(
  target: Map<string, IBulkGraphSession.ISourceDigest>,
  incoming: ReadonlyMap<string, IBulkGraphSession.ISourceDigest>,
): void {
  const existing = new Map<
    string,
    { file: string; digest: IBulkGraphSession.ISourceDigest }
  >();
  for (const [file, digest] of target) {
    const identity = sourceIdentity(file);
    existing.set(identity, { file, digest });
  }
  const pending: [string, IBulkGraphSession.ISourceDigest][] = [];
  for (const [file, digest] of incoming) {
    const identity = sourceIdentity(file);
    const previous = existing.get(identity);
    if (previous !== undefined) {
      if (!sameDigest(previous.digest, digest)) throw conflict(file);
    } else {
      existing.set(identity, { file, digest });
      pending.push([file, digest]);
    }
  }
  for (const [file, digest] of pending) target.set(file, digest);
}

function sourceIdentity(file: string): string {
  if (process.platform !== "win32" || file.startsWith("bundled:///")) {
    return file;
  }
  return path.normalize(file).toLowerCase();
}

function sameDigest(
  left: IBulkGraphSession.ISourceDigest,
  right: IBulkGraphSession.ISourceDigest,
): boolean {
  return (
    left.checkerDigest === right.checkerDigest &&
    left.diskDigest === right.diskDigest
  );
}

function conflict(file: string): Error {
  return new Error(
    `@samchon/graph: strict providers published conflicting source digests for ${file}`,
  );
}
