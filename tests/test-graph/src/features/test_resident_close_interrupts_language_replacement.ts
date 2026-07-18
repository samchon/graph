import { TestValidator } from "@nestia/e2e";
import {
  IIndexerResult,
  ILspSession,
  ISamchonGraphDump,
  createResidentGraphSource,
} from "@samchon/graph";
import fs from "node:fs";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";

interface ResidentDependencies {
  buildLspGraph(options: object): Promise<IIndexerResult>;
}

const emptyDump = (project: string): ISamchonGraphDump => ({
  project,
  languages: [],
  indexer: "static",
  nodes: [],
  edges: [],
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const rejects = async (task: Promise<unknown>, message: string): Promise<void> => {
  let error: unknown;
  try {
    await task;
  } catch (caught) {
    error = caught;
  }
  TestValidator.predicate(message, error instanceof Error);
};

export const test_resident_close_interrupts_language_replacement = async () => {
  // A resident source rebuilds from scratch when the discovered language set
  // changes. `close()` can arrive while that fresh build is still awaiting its
  // language servers. The half-built replacement must never be published, its
  // freshly opened sessions must be disposed, and the caller that triggered the
  // rebuild must be rejected rather than handed a graph from a dead source.
  const root = GraphPaths.createTempDirectory("samchon-graph-resident-close-race-");
  fs.writeFileSync(path.join(root, "first.ts"), "export const first = 1;\n");

  const replaceStarted = deferred<void>();
  const releaseReplace = deferred<void>();
  let builds = 0;
  const freshClosed: string[] = [];
  const closing = createResidentGraphSource(
    { cwd: root },
    {
      buildLspGraph: async () => {
        builds += 1;
        const build = builds;
        // The second build is the language-set replacement. Hold it open so
        // close() can run while it is still in flight.
        if (build === 2) {
          replaceStarted.resolve();
          await releaseReplace.promise;
        }
        const files = fs
          .readdirSync(root)
          .filter((file) => /\.(?:ts|py)$/.test(file));
        const languages = [
          ...(files.some((file) => file.endsWith(".ts"))
            ? (["typescript"] as const)
            : []),
          ...(files.some((file) => file.endsWith(".py"))
            ? (["python"] as const)
            : []),
        ];
        const sessions = new Map();
        for (const language of languages) {
          sessions.set(language, {
            client: {
              close: async () => {
                if (build === 2) freshClosed.push(language);
              },
            },
          } as ILspSession);
        }
        return {
          dump: { ...emptyDump(root), languages, indexer: "lsp" },
          warnings: [],
          sessions,
          sources: new Map(
            files.map((file) => {
              const absolute = path.join(root, file);
              return [absolute, fs.readFileSync(absolute, "utf8")];
            }),
          ),
        } satisfies IIndexerResult;
      },
    } as ResidentDependencies,
  );

  const firstLanguage = await closing.load();
  TestValidator.equals(
    "the first build settles on the single discovered language",
    firstLanguage.languages,
    ["typescript"],
  );

  // Add a second language so the next load discovers a changed set and takes
  // the fresh-rebuild (replaceLanguages) path instead of an in-place refresh.
  fs.writeFileSync(path.join(root, "extra.py"), "value = 1\n");
  const racing = closing.load();
  await replaceStarted.promise;
  const closed = closing.close();
  releaseReplace.resolve();

  await rejects(
    racing,
    "close during a language-set replacement rejects the in-flight caller",
  );
  await closed;
  TestValidator.equals(
    "the interrupted replacement disposes every freshly built session",
    [...freshClosed].sort(),
    ["python", "typescript"],
  );
  await rejects(
    closing.load(),
    "a source closed mid-replacement rejects later loads instead of publishing",
  );
};
