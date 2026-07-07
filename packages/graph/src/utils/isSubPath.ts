import path from "node:path";

export function isSubPath(root: string, candidate: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  // A path that merely starts with ".." (e.g. `..foo`) is still a child; only a
  // bare ".." or one under "../" escapes the root.
  const escapes = rel === ".." || rel.startsWith(`..${path.sep}`);
  return rel === "" || (!escapes && !path.isAbsolute(rel));
}
