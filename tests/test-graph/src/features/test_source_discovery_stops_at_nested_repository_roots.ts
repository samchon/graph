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
    write(root, "lib/index.d.ts", "export declare const publicApi: string;");

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
      ["a.ts", "ambient.d.ts", "index.d.ts", "z.ts"],
    );

    // Capped walk: the cap is spent on real source, not on the worktree file
    // that sorts ahead of it. The authored declaration under `lib` is the
    // first legitimate file; without the repository boundary it would still
    // lose the single slot to `nested.ts`.
    const capped = walkSourceFiles(root, {
      extensions: new Set([".ts"]),
      maxFiles: 1,
    });
    TestValidator.equals(
      "a capped walk fills its slots from the requested checkout",
      bases(capped),
      ["index.d.ts"],
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
      [
        "a.ts",
        "ambient.d.ts",
        "index.d.ts",
        "nested.ts",
        "vendored.ts",
        "z.ts",
      ],
    );

    const compilerRoot = GraphPaths.createTempDirectory(
      "samchon-graph-compiler-output-",
    );
    write(
      compilerRoot,
      "tsconfig.json",
      '{\n  // JSONC is the native TypeScript config format.\n  "compilerOptions": {\n    "outDir": "lib",\n    "declarationDir": "types",\n  },\n}',
    );
    write(compilerRoot, "jsconfig.json", "{ malformed");
    write(
      compilerRoot,
      "lib/generated.d.ts",
      "export declare const generated: string;",
    );
    write(
      compilerRoot,
      "src/source.ts",
      "export const source = 'authored';",
    );
    write(
      compilerRoot,
      "types/generated.d.ts",
      "export declare const generatedType: string;",
    );
    TestValidator.equals(
      "an explicitly configured compiler output is excluded",
      bases(
        walkSourceFiles(compilerRoot, { extensions: new Set([".ts"]) }),
      ),
      ["source.ts"],
    );

    const inheritedRoot = GraphPaths.createTempDirectory(
      "samchon-graph-inherited-output-",
    );
    write(
      inheritedRoot,
      "config/base.json",
      '{"compilerOptions":{"outDir":"../a-output"}}',
    );
    write(
      inheritedRoot,
      "packages/app/tsconfig.json",
      '{"extends":"../../config/base.json"}',
    );
    write(
      inheritedRoot,
      "a-output/generated.d.ts",
      "export declare const generated: string;",
    );
    write(
      inheritedRoot,
      "a-output/authored.go",
      "package authored\n",
    );
    write(
      inheritedRoot,
      "packages/app/src/source.ts",
      "export const source = 'authored';",
    );
    TestValidator.equals(
      "inherited sibling outputs are known before traversal and keep polyglot source",
      bases(
        walkSourceFiles(inheritedRoot, {
          extensions: new Set([".ts", ".go"]),
        }),
      ),
      ["authored.go", "source.ts"],
    );

    const caseRoot = GraphPaths.createTempDirectory(
      "samchon-graph-output-case-",
    );
    write(
      caseRoot,
      "tsconfig.json",
      '{"compilerOptions":{"outDir":"LIB"}}',
    );
    write(
      caseRoot,
      "lib/generated.d.ts",
      "export declare const generated: string;",
    );
    TestValidator.equals(
      "compiler output comparison follows the host filesystem's case rules",
      bases(walkSourceFiles(caseRoot, { extensions: new Set([".ts"]) })),
      process.platform === "win32" ? [] : ["generated.d.ts"],
    );

    const extendsRoot = GraphPaths.createTempDirectory(
      "samchon-graph-output-extends-forms-",
    );
    write(
      extendsRoot,
      "configs/direct.json",
      '{"compilerOptions":{"outDir":"../direct-output"}}',
    );
    write(
      extendsRoot,
      "configs/no-extension.json",
      '{"compilerOptions":{"outDir":"../extension-output"}}',
    );
    write(
      extendsRoot,
      "configs/directory/tsconfig.json",
      '{"compilerOptions":{"declarationDir":"../../directory-output"}}',
    );
    write(
      extendsRoot,
      "configs/cycle-a.json",
      '{"extends":"./cycle-b.json","compilerOptions":{"outDir":"../cycle-output"}}',
    );
    write(
      extendsRoot,
      "configs/cycle-b.json",
      '{"extends":"./cycle-a.json"}',
    );
    write(
      extendsRoot,
      "apps/direct/tsconfig.json",
      '{"extends":"../../configs/direct.json"}',
    );
    write(
      extendsRoot,
      "apps/no-extension/tsconfig.json",
      '{"extends":"../../configs/no-extension"}',
    );
    write(
      extendsRoot,
      "apps/directory/tsconfig.json",
      '{"extends":"../../configs/directory"}',
    );
    write(
      extendsRoot,
      "apps/mixed/tsconfig.json",
      '{"extends":[7,"package-config","../../configs/missing","../../configs/cycle-a.json"]}',
    );
    for (const output of [
      "direct-output",
      "extension-output",
      "directory-output",
      "cycle-output",
    ]) {
      write(
        extendsRoot,
        `${output}/generated.d.ts`,
        "export declare const generated: string;",
      );
    }
    write(
      extendsRoot,
      "apps/mixed/source.ts",
      "export const source = 'authored';",
    );
    TestValidator.equals(
      "local extends forms, arrays, cycles, and unresolved bases stay bounded",
      bases(
        walkSourceFiles(extendsRoot, { extensions: new Set([".ts"]) }),
      ),
      ["source.ts"],
    );
  };

const write = (root: string, file: string, content: string): void => {
  const abs = path.join(root, file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${content}\n`);
};
