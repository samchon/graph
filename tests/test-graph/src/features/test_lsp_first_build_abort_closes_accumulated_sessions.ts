import { TestValidator } from "@nestia/e2e";
import {
  buildLspGraph,
  type GraphLanguage,
  type IBulkGraphSession,
  type ILspSession,
  type ISamchonGraphNode,
} from "@samchon/graph";
import fs from "node:fs";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";

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
};

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
  const snapshot = bulkSnapshot(root);
  const bulk: IBulkGraphSession = {
    kind: "bulk",
    language: "typescript",
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
    resolveTtscGraphCommand: () => ({ command: process.execPath, args: [] }),
    collectTtscGraph: async () => ({ result: snapshot, session: bulk }),
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

function bulkSnapshot(root: string): IBulkGraphSession.ISnapshot {
  return {
    language: "typescript",
    nodes: [graphNode("typescript", "index.ts", "value", "variable")],
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
