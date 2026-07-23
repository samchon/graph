import { IBulkGraphSession } from "../provider/IBulkGraphSession";

/**
 * Merge one strict manifest without letting a later provider hide a conflict.
 */
export function mergeProviderSourceDigests(
  target: Map<string, IBulkGraphSession.ISourceDigest>,
  incoming: ReadonlyMap<string, IBulkGraphSession.ISourceDigest>,
): void {
  for (const [file, digest] of incoming) {
    const previous = target.get(file);
    if (
      previous !== undefined &&
      (previous.checkerDigest !== digest.checkerDigest ||
        previous.diskDigest !== digest.diskDigest)
    ) {
      throw new Error(
        `@samchon/graph: strict providers published conflicting source digests for ${file}`,
      );
    }
  }
  for (const [file, digest] of incoming) target.set(file, digest);
}
