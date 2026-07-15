import { TestValidator } from "@nestia/e2e";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { GraphPaths } from "../internal/GraphPaths";

const importLib = <T>(relative: string): Promise<T> =>
  import(
    pathToFileURL(path.join(GraphPaths.graphPackageRoot, "lib", relative)).href
  ) as Promise<T>;

/**
 * The two pieces of the §4k/§6b derivation whose whole job is a form: the module
 * resolver that turns a re-export specifier into a project file, and the wire
 * that drops from a span the file the reader can reconstruct.
 *
 * They are exercised here directly because their forms are what matters — a
 * `super::` path, a `..` climb, a language with no re-export syntax at all — and
 * building a fixture project per form would say less about each one than the form
 * itself does.
 */
export const test_the_wire_and_the_module_resolver_cover_their_forms = async () => {
  await scenario_the_module_resolver_answers_each_language_it_knows();
  await scenario_the_wire_drops_only_what_the_reader_can_reconstruct();
  await scenario_a_reexport_clause_that_names_no_identifier();
};

const scenario_the_module_resolver_answers_each_language_it_knows = async () => {
  const { resolveModuleFile } = await importLib<{
    resolveModuleFile: (
      language: string,
      from: string,
      specifier: string,
      files: ReadonlySet<string>,
    ) => string | undefined;
  }>("indexer/resolveModuleFile.js");

  const ts = new Set([
    "src/order.ts",
    "src/nested/index.ts",
    "shared/util.ts",
  ]);
  TestValidator.equals(
    "a relative specifier resolves through the extension list",
    resolveModuleFile("typescript", "src/index.ts", "./order", ts),
    "src/order.ts",
  );
  TestValidator.equals(
    "a directory specifier resolves through its index",
    resolveModuleFile("typescript", "src/index.ts", "./nested", ts),
    "src/nested/index.ts",
  );
  TestValidator.equals(
    "a `..` climbs out of the declaring directory",
    resolveModuleFile("typescript", "src/index.ts", "../shared/util", ts),
    "shared/util.ts",
  );
  // Only a chain that stays inside the project can add a module to a project
  // symbol's wire, so a dependency specifier resolves to nothing — and costs the
  // surface count nothing.
  TestValidator.equals(
    "a bare package specifier names nothing in the project",
    resolveModuleFile("typescript", "src/index.ts", "typia", ts),
    undefined,
  );
  TestValidator.equals(
    "and a relative specifier the walk never found resolves to nothing",
    resolveModuleFile("typescript", "src/index.ts", "./missing", ts),
    undefined,
  );

  const py = new Set(["pkg/__init__.py", "pkg/order.py", "shared/__init__.py"]);
  TestValidator.equals(
    "a python sibling module resolves",
    resolveModuleFile("python", "pkg/__init__.py", ".order", py),
    "pkg/order.py",
  );
  TestValidator.equals(
    "each extra leading dot climbs one package",
    resolveModuleFile("python", "pkg/__init__.py", "..shared", py),
    "shared/__init__.py",
  );
  // An absolute python import is not a re-export chain inside the project.
  TestValidator.equals(
    "an absolute python import names nothing relative",
    resolveModuleFile("python", "pkg/__init__.py", "os.path", py),
    undefined,
  );
  TestValidator.equals(
    "and a relative one the walk never found resolves to nothing",
    resolveModuleFile("python", "pkg/__init__.py", ".missing", py),
    undefined,
  );

  const rs = new Set(["src/lib.rs", "src/order/mod.rs", "src/order/line.rs"]);
  TestValidator.equals(
    "a crate-rooted rust path resolves to the module file",
    resolveModuleFile("rust", "src/lib.rs", "crate::order", rs),
    "src/order/mod.rs",
  );
  TestValidator.equals(
    "a path can name an item inside a module, and the longest prefix that is a file wins",
    resolveModuleFile("rust", "src/lib.rs", "crate::order::line", rs),
    "src/order/line.rs",
  );
  TestValidator.equals(
    "a `self::` path is relative to the declaring module",
    resolveModuleFile("rust", "src/order/mod.rs", "self::line", rs),
    "src/order/line.rs",
  );
  TestValidator.equals(
    "a `super::` path climbs to its parent",
    resolveModuleFile("rust", "src/order/mod.rs", "super::order::line", rs),
    "src/order/line.rs",
  );
  TestValidator.equals(
    "a rust path that names no file resolves to nothing",
    resolveModuleFile("rust", "src/lib.rs", "std::collections", rs),
    undefined,
  );
  // A crate laid out without a `src` root still resolves from the repository
  // root, which is what the walk gives it.
  TestValidator.equals(
    "a crate with no src root resolves from the project root",
    resolveModuleFile("rust", "lib.rs", "crate::order", new Set(["order.rs"])),
    "order.rs",
  );

  // Degrade per language, not per tour: a language with no re-export form has no
  // module to resolve, and its symbols still carry the edge from the file that
  // declares them.
  TestValidator.equals(
    "a language with no re-export form resolves nothing",
    resolveModuleFile("go", "order.go", "./order", new Set(["order.go"])),
    undefined,
  );
};

const scenario_the_wire_drops_only_what_the_reader_can_reconstruct = async () => {
  const { wireNodes } = await importLib<{
    wireNodes: (nodes: unknown[]) => {
      evidence?: { file?: string };
      implementation?: { file?: string };
    }[];
  }>("indexer/wireNodes.js");

  const [sameFile, otherFile] = wireNodes([
    {
      id: "src/a.ts#handler:variable",
      kind: "variable",
      language: "typescript",
      name: "handler",
      file: "src/a.ts",
      external: false,
      evidence: { file: "src/a.ts", startLine: 1 },
      // An implementation assigned in the same file: derivable, so it goes.
      implementation: { file: "src/a.ts", startLine: 4, endLine: 6 },
    },
    {
      id: "src/b.ts#other:variable",
      kind: "variable",
      language: "typescript",
      name: "other",
      file: "src/b.ts",
      external: false,
      evidence: { file: "src/b.ts", startLine: 1 },
      // An implementation genuinely in another file: not derivable, so it stays.
      implementation: { file: "src/impl.ts", startLine: 9 },
    },
  ]);

  TestValidator.equals(
    "a declaration span never repeats the node's own file",
    sameFile?.evidence?.file,
    undefined,
  );
  TestValidator.equals(
    "and neither does an implementation span in that same file",
    sameFile?.implementation?.file,
    undefined,
  );
  TestValidator.equals(
    "but an implementation in another file keeps the file it cannot be derived from",
    otherFile?.implementation?.file,
    "src/impl.ts",
  );
};

/**
 * A re-export clause the export syntax allows but that names no identifier the
 * graph could hold forwards nothing.
 */
const scenario_a_reexport_clause_that_names_no_identifier = async () => {
  const { reexportsOf } = await importLib<{
    reexportsOf: (
      language: string,
      file: string,
      text: string,
    ) => { specifier: string; names?: string[] }[];
  }>("indexer/reexportsOf.js");

  TestValidator.equals(
    "a clause with nothing nameable in it forwards nothing",
    reexportsOf("typescript", "src/index.ts", 'export { , } from "./order";'),
    [],
  );
  TestValidator.equals(
    "and a language with no re-export form has none to read",
    reexportsOf("go", "order.go", "package order\n"),
    [],
  );
};
