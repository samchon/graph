/**
 * The source file a node id names. A node id is its coordinates —
 * `path/to/file.ts#Owner.member:kind` — and a file node's id is the path
 * itself, so the file is always in front of the `#`.
 */
export function fileOfNodeId(id: string): string {
  const hash = id.indexOf("#");
  return hash === -1 ? id : id.slice(0, hash);
}
