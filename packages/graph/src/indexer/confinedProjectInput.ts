import fs from "node:fs";
import path from "node:path";

import { isSubPath } from "../utils/isSubPath";
import { normalizePath } from "../utils/normalizePath";

/**
 * Resolve a declared project input without letting a lexical path or an
 * existing symlink/junction ancestor escape the selected checkout.
 */
export function confinedProjectInput(root: string, declared: string): string {
  const resolvedRoot = path.resolve(root);
  if (
    declared === "" ||
    path.isAbsolute(declared) ||
    path.win32.isAbsolute(declared) ||
    declared.replaceAll("\\", "/").split("/").includes("..")
  ) {
    throw new Error(
      `@samchon/graph: build input must be project-relative: ${declared}`,
    );
  }
  const absolute = path.resolve(resolvedRoot, declared);
  /* c8 ignore start -- after absolute paths and every lexical parent segment
   * are rejected above, resolving a relative declaration cannot leave root.
   * This remains a second belt around future validation changes. */
  if (!isSubPath(resolvedRoot, absolute)) {
    throw new Error(
      `@samchon/graph: build input escapes the project: ${declared}`,
    );
  }
  /* c8 ignore stop */

  const realRoot = fs.realpathSync(resolvedRoot);
  let existing = absolute;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    /* c8 ignore start -- resolvedRoot exists and absolute is confined beneath
     * it, so the ancestor walk reaches root before a filesystem fixed point. */
    if (parent === existing) break;
    /* c8 ignore stop */
    existing = parent;
  }
  const realExisting = fs.realpathSync(existing);
  if (!isSubPath(realRoot, realExisting)) {
    throw new Error(
      `@samchon/graph: build input crosses a symlink or junction outside the project: ${declared}`,
    );
  }
  return absolute;
}

export namespace confinedProjectInput {
  /** Normalize one confined input back to a portable project-relative path. */
  export function relative(root: string, declared: string): string {
    return normalizePath(
      path.relative(path.resolve(root), confinedProjectInput(root, declared)),
    );
  }
  /* c8 ignore start -- declaration merging emits an unreachable namespace
   * creation arm after the function object already exists. */
}
/* c8 ignore stop */
