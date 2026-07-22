import { TestValidator } from "@nestia/e2e";
import {
  buildLspGraph,
  type GraphLanguage,
  type IBulkGraphSession,
  type ILspSession,
  type IGraphProvider,
  type ISamchonGraphNode,
} from "@samchon/graph";
import fs from "node:fs";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";
import { ProviderFixtures } from "../internal/ProviderFixtures";

type BuildDependencies = NonNullable<Parameters<typeof buildLspGraph>[1]>;

/** A rejected first build still owns every session it opened before rejection. */
export const test_lsp_first_build_abort_closes_accumulated_sessions = async () => {
  const closed = await runAbortedBuild();
  TestValidator.predicate(
    "the later lane's abort remains the build rejection",
    closed.error === closed.buildError,
  );
  TestValidator.equals(
    "an unpublished bulk session closes exactly once",
    closed.bulkCloseCalls,
    1,
  );
  TestValidator.equals(
    "an unpublished generic session closes exactly once",
    closed.genericCloseCalls,
    1,
  );

  const bulkCloseFailure = "bulk close failed";
  const genericCloseFailure = new Error("generic close failed");
  const failedClose = await runAbortedBuild(
    bulkCloseFailure,
    genericCloseFailure,
  );
  TestValidator.equals(
    "one close failure does not skip another accumulated session",
    [failedClose.bulkCloseCalls, failedClose.genericCloseCalls],
    [1, 1],
  );
  TestValidator.predicate(
    "cleanup failures retain the build error and normalize close failures",
    failedClose.error instanceof AggregateError &&
      failedClose.error.errors[0] === failedClose.buildError &&
      failedClose.error.errors[1] instanceof Error &&
      failedClose.error.errors[1].message === bulkCloseFailure &&
      failedClose.error.errors[2] === genericCloseFailure,
  );

  await assertStrictProviderCancellationBoundary();
  await assertARejectedStrictSnapshotClosesItsUnpublishedSession();
  await assertARefreshFailureRetainsItsCloseFailure();
};

async function assertStrictProviderCancellationBoundary(): Promise<void> {
  const root = GraphPaths.createTempDirectory(
    "samchon-graph-strict-provider-abort-",
  );
  fs.writeFileSync(path.join(root, "tsconfig.json"), "{}\n");
  fs.writeFileSync(path.join(root, "index.ts"), "export const value = 1;\n");
  installCommand(root, "ttscserver");

  const session = {
    client: { close: async () => undefined },
    root,
    language: "typescript",
    opened: new Map(),
    diagnostics: new Map(),
  } as ILspSession;
  const strictError = new Error("strict provider cancelled");
  const cancelled = new AbortController();
  let genericCalls = 0;
  let error: unknown;
  try {
    await buildLspGraph(
      {
        cwd: root,
        languages: ["typescript"],
        signal: cancelled.signal,
      },
      {
        providers: [fakeProvider()],
        collectProviderGraph: async () => {
          cancelled.abort("strict provider cancelled");
          throw strictError;
        },
        collectLanguageGraph: async () => {
          genericCalls += 1;
          return {
            result: {
              nodes: [graphNode("typescript", "index.ts", "value", "variable")],
              edges: [],
              diagnostics: [],
              warnings: [],
            },
            session,
          };
        },
      },
    );
  } catch (caught) {
    error = caught;
  }
  TestValidator.predicate(
    "strict-provider cancellation is rethrown without generic fallback",
    error === strictError && genericCalls === 0,
  );

  const live = new AbortController();
  const fallbackError = new Error("strict provider unavailable");
  const fallback = await buildLspGraph(
    {
      cwd: root,
      languages: ["typescript"],
      signal: live.signal,
    },
    {
      providers: [fakeProvider()],
      collectProviderGraph: async () => {
        throw fallbackError;
      },
      collectLanguageGraph: async () => {
        genericCalls += 1;
        return {
          result: {
            nodes: [graphNode("typescript", "index.ts", "value", "variable")],
            edges: [],
            diagnostics: [],
            warnings: [],
          },
          session,
        };
      },
    },
  );
  TestValidator.predicate(
    "a live signal still permits documented generic fallback",
    genericCalls === 1 &&
      fallback.warnings.some((warning) =>
        warning.includes(fallbackError.message),
      ),
  );

  await assertAnUnpublishedLanguageIsReported();
}

async function assertARejectedStrictSnapshotClosesItsUnpublishedSession(): Promise<void> {
  const root = GraphPaths.createTempDirectory(
    "samchon-graph-rejected-strict-close-",
  );
  fs.writeFileSync(path.join(root, "index.ts"), "export const value = 1;\n");

  const provider = ProviderFixtures.provider({
    name: "invalid",
    facts: ["calls"],
  });
  const snapshot = ProviderFixtures.snapshot({
    provider: "invalid",
    facts: ["imports"],
    nodes: [graphNode("typescript", "index.ts", "strict")],
  });
  let bulkCloseCalls = 0;
  const bulk: IBulkGraphSession = {
    kind: "bulk",
    languages: ["typescript"],
    root,
    generation: 1,
    current: snapshot,
    refresh: async () => ({
      changed: false,
      generation: 1,
      mode: "unchanged",
      snapshot,
    }),
    close: async () => {
      bulkCloseCalls += 1;
    },
  };
  const generic = {
    client: { close: async () => undefined },
    root,
    language: "typescript",
    opened: new Map(),
    diagnostics: new Map(),
  } as ILspSession;

  const result = await buildLspGraph(
    { cwd: root, languages: ["typescript"], keepAlive: true },
    {
      providers: [provider],
      collectProviderGraph: async () => ({
        refresh: { changed: true, generation: 1, mode: "initial", snapshot },
        session: bulk,
      }),
      collectLanguageGraph: async () => ({
        result: {
          nodes: [graphNode("typescript", "index.ts", "value", "variable")],
          edges: [],
          diagnostics: [],
          warnings: [],
        },
        session: generic,
      }),
    },
  );
  TestValidator.equals(
    "a rejected strict snapshot closes the session that never reached state",
    bulkCloseCalls,
    1,
  );
  TestValidator.predicate(
    "a refused strict snapshot falls back without retaining its facts",
    result.warnings.some((warning) => warning.includes("registered to prove")) &&
      result.dump.nodes.some((node) => node.id === "index.ts#value:variable") &&
      !result.dump.nodes.some((node) => node.id === "index.ts#strict:function"),
  );
  await generic.client.close();
}

async function assertARefreshFailureRetainsItsCloseFailure(): Promise<void> {
  const root = GraphPaths.createTempDirectory(
    "samchon-graph-strict-refresh-close-",
  );
  fs.writeFileSync(path.join(root, "index.ts"), "export const value = 1;\n");

  const refreshError = new Error("strict refresh failed");
  const closeError = new Error("strict cleanup failed");
  const cancelled = new AbortController();
  let closeCalls = 0;
  const provider = ProviderFixtures.provider({
    name: "refresh-close",
    open: (open) => ({
      kind: "bulk",
      languages: open.languages,
      root: open.root,
      generation: 0,
      current: undefined,
      refresh: async () => {
        cancelled.abort("refresh failed");
        throw refreshError;
      },
      close: async () => {
        closeCalls += 1;
        throw closeError;
      },
    }),
  });

  let failure: unknown;
  try {
    await buildLspGraph(
      { cwd: root, languages: ["typescript"], signal: cancelled.signal },
      { providers: [provider] },
    );
  } catch (error) {
    failure = error;
  }
  TestValidator.equals(
    "a failed strict refresh still closes its unpublished session once",
    closeCalls,
    1,
  );
  TestValidator.predicate(
    "strict refresh and cleanup failures are both retained",
    failure instanceof AggregateError &&
      failure.errors[0] === refreshError &&
      failure.errors[1] === closeError,
  );
}

/**
 * A provider that owns a language and publishes no slice for it says so.
 *
 * A Clang provider asked for C and C++ can legitimately answer with only the
 * translation units it found. What it must not do is leave the rest to the
 * generic lane in silence: a caller who selected a compiler-owned provider for
 * C would be handed navigation facts for it with nothing to tell them apart.
 */
async function assertAnUnpublishedLanguageIsReported(): Promise<void> {
  const root = GraphPaths.createTempDirectory("samchon-graph-partial-slice-");
  fs.writeFileSync(path.join(root, "tsconfig.json"), "{}\n");
  fs.writeFileSync(path.join(root, "index.ts"), "export const value = 1;\n");
  fs.writeFileSync(path.join(root, "main.go"), "package main\nfunc main() {}\n");
  installCommand(root, "gopls");

  const generic = {
    client: { close: async () => undefined },
    root,
    language: "go",
    opened: new Map(),
    diagnostics: new Map(),
  } as ILspSession;

  const snapshot = ProviderFixtures.snapshot({
    languages: ["typescript"],
    // Attributed to the registered entry, or the contract check rejects it
    // before the unpublished-language report is ever reached.
    provider: "partial",
    nodes: [graphNode("typescript", "index.ts", "value", "variable")],
  });
  const result = await buildLspGraph(
    { cwd: root, languages: ["typescript", "go"] },
    {
      // Owns both, answers for only one — which is legitimate, and must be
      // said rather than left to the generic lane in silence.
      providers: [
        ProviderFixtures.provider({
          name: "partial",
          languages: ["typescript", "go"],
        }),
      ],
      collectProviderGraph: async () => ({
        refresh: { changed: true, generation: 1, mode: "initial", snapshot },
        session: {
          kind: "bulk",
          languages: ["typescript", "go"],
          root,
          generation: 1,
          current: snapshot,
          refresh: async () => ({
            changed: false,
            generation: 1,
            mode: "unchanged" as const,
            snapshot,
          }),
          close: async () => undefined,
        },
      }),
      collectLanguageGraph: async () => ({
        result: {
          nodes: [graphNode("go", "main.go", "main")],
          edges: [],
          diagnostics: [],
          warnings: [],
        },
        session: generic,
      }),
    },
  );
  TestValidator.predicate(
    "a language a provider owns but does not publish is reported",
    result.warnings.some(
      (warning) =>
        warning.startsWith("go:") &&
        warning.includes("partial") &&
        warning.includes("published no slice"),
    ),
  );
  TestValidator.predicate(
    "…and the generic lane really did serve it",
    result.dump.nodes.some((node) => node.language === "go"),
  );
}

async function runAbortedBuild(
  bulkCloseFailure?: unknown,
  genericCloseFailure?: unknown,
): Promise<{
  error: unknown;
  buildError: Error;
  bulkCloseCalls: number;
  genericCloseCalls: number;
}> {
  const root = GraphPaths.createTempDirectory(
    "samchon-graph-lsp-accumulated-close-",
  );
  fs.writeFileSync(path.join(root, "tsconfig.json"), "{}\n");
  fs.writeFileSync(path.join(root, "index.ts"), "export const value = 1;\n");
  fs.writeFileSync(path.join(root, "main.go"), "package main\nfunc main() {}\n");
  fs.writeFileSync(path.join(root, "app.py"), "def app():\n    pass\n");
  installCommand(root, "gopls");
  installCommand(root, "pyright-langserver");

  const controller = new AbortController();
  const buildError = new Error("later language aborted");
  let bulkCloseCalls = 0;
  let genericCloseCalls = 0;
  const snapshot = bulkSnapshot();
  const bulk: IBulkGraphSession = {
    kind: "bulk",
    languages: ["typescript"],
    root,
    generation: 1,
    current: snapshot,
    refresh: async () => ({
      changed: false,
      generation: 1,
      mode: "unchanged",
      snapshot,
    }),
    close: () => {
      bulkCloseCalls += 1;
      return bulkCloseFailure === undefined
        ? Promise.resolve()
        : Promise.reject(bulkCloseFailure);
    },
  };
  const generic = {
    client: {
      close: () => {
        genericCloseCalls += 1;
        return genericCloseFailure === undefined
          ? Promise.resolve()
          : Promise.reject(genericCloseFailure);
      },
    },
    root,
    language: "go",
    opened: new Map(),
    diagnostics: new Map(),
  } as ILspSession;

  const dependencies: BuildDependencies = {
    providers: [fakeProvider()],
    collectProviderGraph: async () => ({
      refresh: {
        changed: true,
        generation: 1,
        mode: "initial",
        snapshot,
      },
      session: bulk,
    }),
    collectLanguageGraph: async (_root, language) => {
      if (language === "go") {
        return {
          result: {
            nodes: [graphNode("go", "main.go", "main")],
            edges: [],
            diagnostics: [],
            warnings: [],
          },
          session: generic,
        };
      }
      controller.abort("later language failed");
      throw buildError;
    },
  };

  let error: unknown;
  try {
    await buildLspGraph(
      {
        cwd: root,
        languages: ["typescript", "go", "python"],
        keepAlive: true,
        signal: controller.signal,
      },
      dependencies,
    );
  } catch (caught) {
    error = caught;
  }
  return {
    error,
    buildError,
    bulkCloseCalls,
    genericCloseCalls,
  };
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

/**
 * The one registered provider these builds select.
 *
 * Registered rather than pre-selected: real discovery runs against it, so the
 * candidate these tests exercise is one `selectGraphProviders` actually
 * produced.
 */
function fakeProvider(): IGraphProvider {
  return ProviderFixtures.provider();
}

function bulkSnapshot(): IBulkGraphSession.ISnapshot {
  return ProviderFixtures.snapshot({
    nodes: [graphNode("typescript", "index.ts", "value", "variable")],
  });
}

function graphNode(
  language: GraphLanguage,
  file: string,
  name: string,
  kind: ISamchonGraphNode["kind"] = "function",
): ISamchonGraphNode {
  return {
    id: `${file}#${name}:${kind}`,
    kind,
    language,
    name,
    file,
    external: false,
  };
}
