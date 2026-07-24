import { TestValidator } from "@nestia/e2e";
import {
  buildGraphResult,
  buildLspGraph,
  buildStaticGraphResult,
  createResidentGraphSource,
  type GraphLanguage,
  type ILspSession,
  type ISamchonGraphNode,
} from "@samchon/graph";
import fs from "node:fs";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";
import { ProviderFixtures } from "../internal/ProviderFixtures";

type BuildDependencies = NonNullable<Parameters<typeof buildLspGraph>[1]>;

/**
 * Authored TypeScript declarations are source in every indexing lane.
 *
 * A `.d.ts` suffix says that the file contains declarations; it does not say
 * that this checkout generated it. Output ownership comes from ignored and
 * configured compiler-output directories, while an authored declaration-only
 * package must still discover TypeScript and commit the same project input
 * generation as an ordinary `.ts` package.
 */
export const test_typescript_declarations_are_first_class_project_inputs =
  async () => {
    const root = GraphPaths.createTempDirectory(
      "samchon-graph-authored-declarations-",
    );
    const declaration = path.join(root, "index.d.ts");
    fs.writeFileSync(declaration, declarationSource("publicApi"));

    const expected = ["Augmented", "Color", "Window", "publicApi"];
    const automatic = buildStaticGraphResult({ cwd: root });
    const explicit = buildStaticGraphResult({
      cwd: root,
      languages: ["typescript"],
    });
    TestValidator.equals(
      "a declaration-only package discovers TypeScript automatically",
      automatic.dump.languages,
      ["typescript"],
    );
    TestValidator.equals(
      "static fallback retains exported, ambient-global, and augmented declarations",
      namesOf(automatic.dump.nodes),
      expected,
    );
    TestValidator.equals(
      "automatic and explicit TypeScript selection see the same declarations",
      namesOf(explicit.dump.nodes),
      expected,
    );
    const oneShot = await buildGraphResult({ cwd: root, mode: "static" });
    TestValidator.predicate(
      "a static one-shot dump closes the same coordinator generation fence",
      oneShot.inputGeneration !== undefined &&
        /^[a-f0-9]{64}$/.test(oneShot.inputGeneration) &&
        namesOf(oneShot.dump.nodes).length === expected.length,
    );

    const fakeDependencies = genericDependencies();
    const generic = await buildLspGraph(
      {
        cwd: root,
        languages: ["typescript"],
        server: process.execPath,
        serverArgs: [],
      },
      fakeDependencies,
    );
    TestValidator.equals(
      "the generic LSP lane opens authored declaration files",
      namesOf(generic.dump.nodes),
      expected,
    );

    fs.writeFileSync(path.join(root, "main.lua"), "function luaEntry() end\n");
    const hybrid = await buildLspGraph(
      {
        cwd: root,
        languages: ["typescript", "lua"],
        server: process.execPath,
        serverArgs: [],
      },
      fakeDependencies,
    );
    TestValidator.predicate(
      "a hybrid build keeps declaration facts beside a fallback language",
      hybrid.dump.indexer === "hybrid" &&
        expected.every((name) =>
          hybrid.dump.nodes.some(
            (node) => node.language === "typescript" && node.name === name,
          ),
        ) &&
        hybrid.dump.nodes.some(
          (node) => node.language === "lua" && node.name === "luaEntry",
        ),
    );

    const strictNodes = declarationNodes(["index.d.ts"]);
    const strictSnapshot = ProviderFixtures.snapshot({
      root,
      provider: "declaration-owner",
      nodes: strictNodes,
    });
    const strictProvider = ProviderFixtures.provider({
      name: "declaration-owner",
      open: (options) =>
        ProviderFixtures.session({
          root: options.root,
          languages: [...options.languages],
          snapshots: [strictSnapshot],
        }),
    });
    const strict = await buildLspGraph(
      { cwd: root, languages: ["typescript"] },
      { providers: [strictProvider] },
    );
    TestValidator.equals(
      "strict ownership is eligible from an authored declaration-only program",
      [strict.dump.provenance?.[0]?.provider, namesOf(strict.dump.nodes)],
      ["declaration-owner", expected],
    );

    fs.rmSync(path.join(root, "main.lua"));
    const resident = createResidentGraphSource({
      cwd: root,
      mode: "static",
      languages: ["typescript"],
    });
    const first = await resident.load();
    const firstGeneration = resident.inputGeneration();
    fs.writeFileSync(declaration, declarationSource("changedApi"));
    const edited = await resident.load();
    const editedGeneration = resident.inputGeneration();
    const renamed = path.join(root, "renamed.d.ts");
    fs.renameSync(declaration, renamed);
    const moved = await resident.load();
    TestValidator.predicate(
      "declaration create/edit/rename participates in resident generations",
      first.nodes.some((node) => node.name === "publicApi") &&
        edited.nodes.some((node) => node.name === "changedApi") &&
        moved.nodes.some(
          (node) =>
            node.name === "changedApi" && node.file === "renamed.d.ts",
        ) &&
        firstGeneration !== editedGeneration &&
        editedGeneration !== resident.inputGeneration(),
    );
    await resident.close();
  };

function genericDependencies(): BuildDependencies {
  return {
    providers: [],
    collectLanguageGraph: async (
      root,
      language,
      _command,
      _args,
      files,
    ) => {
      if (language !== "typescript") {
        throw new Error(`${language}: deterministic fallback fixture`);
      }
      const session = genericSession(root, language, files);
      return {
        result: {
          nodes: declarationNodes(
            files.map((file) => path.relative(root, file).replaceAll("\\", "/")),
          ),
          edges: [],
          diagnostics: [],
          warnings: [],
        },
        session,
      };
    },
  };
}

function genericSession(
  root: string,
  language: GraphLanguage,
  files: readonly string[],
): ILspSession {
  return {
    client: { close: async () => undefined } as ILspSession["client"],
    root,
    language,
    opened: new Map(
      files.map((absolute, index) => {
        const relative = path.relative(root, absolute).replaceAll("\\", "/");
        return [
          relative,
          {
            abs: absolute,
            text: fs.readFileSync(absolute, "utf8"),
            version: index + 1,
          },
        ];
      }),
    ),
    diagnostics: new Map(),
  };
}

function declarationNodes(files: readonly string[]): ISamchonGraphNode[] {
  const file = files.find((candidate) => candidate.endsWith(".d.ts"));
  if (file === undefined) return [];
  return [
    declarationNode(file, "publicApi", "function"),
    declarationNode(file, "Color", "enum"),
    declarationNode(file, "Window", "interface"),
    declarationNode(file, "Augmented", "interface"),
  ];
}

function declarationNode(
  file: string,
  name: string,
  kind: "enum" | "function" | "interface",
): ISamchonGraphNode {
  return {
    id: `${file}#${name}:${kind}`,
    kind,
    language: "typescript",
    name,
    file,
    external: false,
    exported: true,
  };
}

function declarationSource(api: string): string {
  return [
    `export declare function ${api}(input: string): string;`,
    "export declare const enum Color { Red, Blue }",
    "declare global {",
    "  interface Window { graphReady: boolean; }",
    "}",
    'declare module "fixture-package" {',
    "  export interface Augmented { value: string; }",
    "}",
    "",
  ].join("\n");
}

function namesOf(
  nodes: readonly { name: string; language?: string }[],
): string[] {
  return nodes
    .filter((node) => node.language === undefined || node.language === "typescript")
    .map((node) => node.name)
    .filter((name) =>
      ["Augmented", "Color", "Window", "publicApi"].includes(name),
    )
    .sort();
}
