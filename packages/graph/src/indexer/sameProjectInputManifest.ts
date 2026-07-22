export function sameProjectInputManifest(
  left: ReadonlyMap<string, string>,
  right: ReadonlyMap<string, string>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [file, digest] of left) {
    if (right.get(file) !== digest) return false;
  }
  return true;
}
