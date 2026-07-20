import { TestValidator } from "@nestia/e2e";
import {
  buildLspGraph,
  buildStaticGraphResult,
  createResidentGraphSource,
  type GraphLanguage,
  type IBulkGraphSession,
  type ILspSession,
  type ISamchonGraphNode,
} from "@samchon/graph";
import fs from "node:fs";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";

type BuildDependencies = NonNullable<Parameters<typeof buildLspGraph>[1]>;

/** Requested languages share one source cap across one-shot and resident lanes. */
export const test_requested_languages_are_normalized_before_global_source_selection = async () => {
  const root = GraphPaths.createTempDirectory("samchon-graph-language-cap-");
  fs.writeFileSync(path.join(root, "a.go"), "package main\nfunc First() {}\n");
  fs.writeFileSync(path.join(root, "b.ts"), "export const second = 2;\n");
  fs.writeFileSync(path.join(root, "c.lua"), "function third() end\n");
  fs.writeFileSync(path.join(root, "z.go"), "package main\nfunc Last() {}\n");
  installCommand(root, "gopls");
  installCommand(root, "ttscserver");

  await assertGenericDuplicatesAndGlobalCap(root);
  await assertStrictDuplicatesAreNotOpenedTwice(root);
  await assertFallbackDuplicatesAndStaticResidentCap(root);
  await assertUnsupportedExplicitLanguageFailsBeforeIndexing(root);
};

async function assertGenericDuplicatesAndGlobalCap(root: string): Promise<void> {
  const calls: GraphLanguage[] = [];
  const dependencies: BuildDependencies = {
    resolveTtscGraphCommand: () => undefined,
    collectLanguageGraph: async (_root, language) => {
      calls.push(language);
      return {
        result: {
          nodes: [graphNode(language, language === "go" ? "a.go" : "b.ts")],
          edges: [],
          diagnostics: [],
          warnings: [],
        },
        session: genericSession(language),
      };
    },
  };
  const capped = await buildLspGraph(
    {
      cwd: root,
      languages: ["go", "typescript", "go"],
      maxFiles: 1,
      keepAlive: true,
    },
    dependencies,
  );
  TestValidator.equals(
    "one globally selected file opens only its language once",
    calls,
    ["go"],
  );
  TestValidator.equals(
    "a duplicate generic language cannot overwrite a kept session",
    capped.sessions?.size,
    1,
  );

  calls.length = 0;
  const unlimited = await buildLspGraph(
    {
      cwd: root,
      languages: ["go", "typescript", "go"],
      keepAlive: true,
    },
    dependencies,
  );
  TestValidator.equals(
    "unlimited selection still retains the first requested-language order",
    calls,
    ["go", "typescript"],
  );
  await closeSessions(capped, unlimited);
}

async function assertStrictDuplicatesAreNotOpenedTwice(root: string): Promise<void> {
  let calls = 0;
  let closes = 0;
  const session: IBulkGraphSession = {
    kind: "bulk",
    language: "typescript",
    root,
    generation: 1,
    current: strictSnapshot(root),
    refresh: async () => ({
      changed: false,
      generation: 1,
      mode: "unchanged",
      snapshot: strictSnapshot(root),
    }),
    close: async () => {
      closes += 1;
    },
  };
  const result = await buildLspGraph(
    {
      cwd: root,
      languages: ["typescript", "typescript"],
      keepAlive: true,
    },
    {
      resolveTtscGraphCommand: () => ({ command: process.execPath, args: [] }),
      collectTtscGraph: async () => {
        calls += 1;
        return { result: strictSnapshot(root), session };
      },
    },
  );
  TestValidator.equals("one strict language is opened once", calls, 1);
  TestValidator.equals("one strict session is retained", result.sessions?.size, 1);
  await session.close();
  TestValidator.equals("the retained strict session closes once", closes, 1);
}

async function assertFallbackDuplicatesAndStaticResidentCap(root: string): Promise<void> {
  const fallback = await buildLspGraph({
    cwd: root,
    languages: ["lua", "lua"],
    server: "samchon-graph-missing-lsp",
    keepAlive: true,
  });
  TestValidator.equals("one fallback language is reported", fallback.dump.languages, ["lua"]);
  TestValidator.equals(
    "duplicate fallback languages produce one unavailable-server warning",
    fallback.warnings.filter((warning) => warning.includes("LSP server not found")).length,
    1,
  );

  const staticResult = buildStaticGraphResult({
    cwd: root,
    languages: ["go", "typescript"],
    maxFiles: 1,
  });
  TestValidator.equals(
    "the static lane consumes the same globally capped source set",
    [...staticResult.sources!.keys()].map((file) => path.basename(file)),
    ["a.go"],
  );

  const resident = createResidentGraphSource({
    cwd: root,
    mode: "static",
    languages: ["go", "typescript"],
    maxFiles: 1,
  });
  const initial = await resident.load();
  fs.writeFileSync(path.join(root, "a.go"), "package main\nfunc Changed() {}\n");
  const refreshed = await resident.load();
  TestValidator.predicate(
    "resident refresh keeps the shared cap and observes its selected source",
    initial.nodes.some((node) => node.name === "First") &&
      refreshed.nodes.some((node) => node.name === "Changed") &&
      refreshed.nodes.every((node) => node.language === "go"),
  );
  await resident.close();
}

async function assertUnsupportedExplicitLanguageFailsBeforeIndexing(
  root: string,
): Promise<void> {
  await TestValidator.error("an explicit unknown language is rejected", async () => {
    await buildLspGraph({
      cwd: root,
      languages: ["unknown"],
    });
  });
  await TestValidator.error("runtime language drift is rejected precisely", () =>
    buildStaticGraphResult({
      cwd: root,
      languages: [123 as unknown as GraphLanguage],
    }),
  );
}

function genericSession(language: GraphLanguage): ILspSession {
  return {
    client: { close: async () => undefined } as ILspSession["client"],
    root: "",
    language,
    opened: new Map(),
    diagnostics: new Map(),
  };
}

function graphNode(language: GraphLanguage, file: string): ISamchonGraphNode {
  return {
    id: `${file}#value:function`,
    kind: "function",
    language,
    name: "value",
    file,
    external: false,
  };
}

function strictSnapshot(root: string): IBulkGraphSession.ISnapshot {
  return {
    language: "typescript",
    nodes: [graphNode("typescript", "b.ts")],
    edges: [],
    diagnostics: [],
    sources: new Map(),
    provenance: {
      schemaVersion: 5,
      tool: "test",
      toolVersion: "1",
      compilerVersion: "1",
      protocolVersion: 1,
      universe: root,
      capabilities: [],
    },
    warnings: [],
  };
}

async function closeSessions(
  ...results: Awaited<ReturnType<typeof buildLspGraph>>[]
): Promise<void> {
  const sessions = new Set(
    results.flatMap((result) => [...(result.sessions?.values() ?? [])]),
  );
  for (const session of sessions) {
    if ("kind" in session) await session.close();
    else await session.client.close();
  }
}

function installCommand(root: string, command: string): void {
  const directory = path.join(root, "node_modules", ".bin");
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(
    directory,
    process.platform === "win32" ? `${command}.cmd` : command,
  );
  fs.writeFileSync(
    file,
    process.platform === "win32" ? "@exit /b 0\r\n" : "#!/bin/sh\nexit 0\n",
  );
  if (process.platform !== "win32") fs.chmodSync(file, 0o755);
}
