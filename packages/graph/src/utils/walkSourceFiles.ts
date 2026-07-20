import fs from "node:fs";
import path from "node:path";
import { compareOrdinal } from "@samchon/graph-sitter";
import { DEFAULT_IGNORES } from "./DEFAULT_IGNORES";
import { IWalkOptions } from "./IWalkOptions";

export function walkSourceFiles(root: string, options: IWalkOptions): string[] {
  const out: string[] = [];
  const ignoreDirs = options.ignoreDirs ?? DEFAULT_IGNORES;
  const allowNested = options.allowNestedRepositories ?? false;
  const visit = (dir: string): void => {
    if (options.maxFiles !== undefined && out.length >= options.maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => compareOrdinal(a.name, b.name));
    for (const entry of entries) {
      if (options.maxFiles !== undefined && out.length >= options.maxFiles) break;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (ignoreDirs.has(entry.name)) continue;
        // A subdirectory that is itself a git repository or worktree root —
        // marked by a `.git` directory (a clone) or a `.git` file (a linked
        // worktree or a submodule) — belongs to a different checkout: a nested
        // agent worktree, a vendored clone, a submodule. Merging its files into
        // this graph would describe a foreign branch and lets an unrelated tree
        // win a `maxFiles` cap before any real source is seen. Stop at that
        // boundary unless the caller intentionally opts in.
        if (!allowNested && isRepositoryRoot(abs)) continue;
        visit(abs);
        continue;
      }
      /* c8 ignore next */
      if (!entry.isFile()) continue;
      // `.d.ts` declaration files end in `.ts` (path.extname keeps only the
      // last dot segment), so without this check a compiled `lib/*.d.ts`
      // output tree would be indexed as if it were real TypeScript source.
      if (entry.name.endsWith(".d.ts")) continue;
      if (options.extensions.has(path.extname(entry.name).toLowerCase())) {
        out.push(abs);
      }
    }
  };
  visit(path.resolve(root));
  return out;
}

/**
 * A directory is a self-contained checkout when it carries a `.git` marker: a
 * directory in an ordinary clone, or a file in a linked worktree or submodule.
 * The requested root is walked directly and is never subjected to this test, so
 * only nested checkouts below it are excluded.
 */
function isRepositoryRoot(dir: string): boolean {
  return fs.existsSync(path.join(dir, ".git"));
}
