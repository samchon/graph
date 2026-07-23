import fs from "node:fs";
import path from "node:path";
import { compareOrdinal } from "@samchon/graph-sitter";
import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import { DEFAULT_IGNORES } from "./DEFAULT_IGNORES";
import { IWalkOptions } from "./IWalkOptions";

export function walkSourceFiles(root: string, options: IWalkOptions): string[] {
  const out: string[] = [];
  const compilerOutputs = new Set<string>();
  const ignoreDirs = options.ignoreDirs ?? DEFAULT_IGNORES;
  const allowNested = options.allowNestedRepositories ?? false;
  const visit = (dir: string): void => {
    if (options.maxFiles !== undefined && out.length >= options.maxFiles) return;
    registerCompilerOutputs(dir, compilerOutputs);
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
        if (compilerOutputs.has(path.resolve(abs))) continue;
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

/**
 * Register only output directories a project config explicitly declares.
 *
 * Names such as `lib` are ordinary authored-source conventions too, especially
 * for declaration-only packages. Treating the name itself as generated drops
 * real APIs. A valid JSON config that names the directory is positive evidence
 * that this particular directory is compiler output; an unreadable or
 * malformed config provides no such evidence and therefore excludes nothing.
 */
function registerCompilerOutputs(
  directory: string,
  outputs: Set<string>,
): void {
  for (const name of ["tsconfig.json", "jsconfig.json"]) {
    const config = path.join(directory, name);
    if (!fs.existsSync(config)) continue;
    let text: string;
    try {
      text = fs.readFileSync(config, "utf8");
      /* c8 ignore start -- a concurrently removed config is not evidence that
       * any directory is generated, so discovery stays open. */
    } catch {
      continue;
    }
    /* c8 ignore stop */
    const errors: ParseError[] = [];
    const compilerOptions = (
      parseJsonc(text, errors, {
        allowTrailingComma: true,
        disallowComments: false,
      }) as
        | {
            compilerOptions?: {
              outDir?: unknown;
              declarationDir?: unknown;
            };
          }
        | undefined
    )?.compilerOptions;
    if (errors.length > 0) continue;
    for (const value of [
      compilerOptions?.outDir,
      compilerOptions?.declarationDir,
    ]) {
      if (typeof value === "string") {
        outputs.add(path.resolve(directory, value));
      }
    }
  }
}
