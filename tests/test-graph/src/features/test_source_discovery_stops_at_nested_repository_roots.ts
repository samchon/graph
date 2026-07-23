import { TestValidator } from "@nestia/e2e";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { GraphPaths } from "../internal/GraphPaths";

const importLib = <T>(relative: string): Promise<T> =>
  import(
    pathToFileURL(path.join(GraphPaths.graphPackageRoot, "lib", relative)).href
  ) as Promise<T>;

interface IWalkOptions {
  extensions: ReadonlySet<string>;
  maxFiles?: number;
  allowNestedRepositories?: boolean;
}

/**
 * Source discovery stops at nested repository and worktrees roots.
 *
 * The walk excludes a fixed set of directory names, but a nested checkout — an
 * agent worktree under `.claude/worktrees`, a vendored clone, a submodule —
 * carries real source by every filename test the walk applies. Left alone it
 * merges a foreign branch into the graph and, worse, its files sort ahead of
 * the checkout's own and win a `maxFiles` cap before any real source is seen.
 *
 * The boundary is the `.git` marker each checkout carries: a directory in a
 * clone, a file in a linked worktree or submodule. The requested root is walked
 * directly and keeps its own `.git`; only nested checkouts below it are cut,
 * unless a caller opts into a vendored repository on purpose.
 */
export const test_source_discovery_stops_at_nested_repository_roots =
  async () => {
    const { walkSourceFiles } = await importLib<{
      walkSourceFiles: (root: string, options: IWalkOptions) => string[];
    }>("utils/walkSourceFiles.js");

    const root = GraphPaths.createTempDirectory("samchon-graph-nested-repo-");
    // The checkout's own source, and its own `.git` — a root is never excluded.
    fs.mkdirSync(path.join(root, ".git"), { recursive: true });
    write(root, "src/a.ts", "export const a = 1;");
    write(root, "src/ambient.d.ts", "declare const ambient: unique symbol;");
    write(root, "src/z.ts", "export const z = 1;");

    // A linked agent worktree: `.claude/worktrees/wt` carries a `.git` *file*.
    // It sorts ahead of `src`, so an uncut walk would fill a cap from here.
    write(
      root,
      ".claude/worktrees/wt/.git",
      "gitdir: /elsewhere/.git/worktrees/wt\n",
    );
    write(root, ".claude/worktrees/wt/nested.ts", "export const nested = 1;");

    // A vendored clone: `embedded` carries a `.git` *directory*.
    fs.mkdirSync(path.join(root, "embedded", ".git"), { recursive: true });
    write(root, "embedded/vendored.ts", "export const vendored = 1;");

    const bases = (files: string[]): string[] =>
      files.map((file) => path.basename(file)).sort();

    // Default walk: only the checkout's own source, in either cap state.
    const discovered = walkSourceFiles(root, { extensions: new Set([".ts"]) });
    TestValidator.equals(
      "a nested worktree and a vendored clone are excluded from discovery",
      bases(discovered),
      ["a.ts", "ambient.d.ts", "z.ts"],
    );

    // Capped walk: the cap is spent on real source, not on the worktree file
    // that sorts ahead of it. `.claude` < `embedded` < `src`, so without the
    // boundary the single slot would be `nested.ts`.
    const capped = walkSourceFiles(root, {
      extensions: new Set([".ts"]),
      maxFiles: 1,
    });
    TestValidator.equals(
      "a capped walk fills its slots from the requested checkout",
      bases(capped),
      ["a.ts"],
    );

    // Opt-in: an intentionally vendored repository is indexed on request, and a
    // `.git` file is never mistaken for source.
    const withNested = walkSourceFiles(root, {
      extensions: new Set([".ts"]),
      allowNestedRepositories: true,
    });
    TestValidator.equals(
      "an explicit opt-in indexes nested repositories",
      bases(withNested),
      ["a.ts", "ambient.d.ts", "nested.ts", "vendored.ts", "z.ts"],
    );
  };

const write = (root: string, file: string, content: string): void => {
  const abs = path.join(root, file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${content}\n`);
};
