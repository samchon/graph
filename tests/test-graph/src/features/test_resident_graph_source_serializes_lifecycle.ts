import { TestValidator } from "@nestia/e2e";
import {
  IIndexerResult,
  ILspSession,
  IResidentGraphSource,
  ISamchonGraphDump,
  SamchonGraphMemory,
  createResidentGraphSource,
} from "@samchon/graph";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { GraphPaths } from "../internal/GraphPaths";

interface ResidentMemoryModule {
  createResidentGraphMemorySource(
    resident: IResidentGraphSource,
  ): () => Promise<SamchonGraphMemory>;
}

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

const resultOf = (
  dump: ISamchonGraphDump,
  sessions = new Map(),
): IIndexerResult => ({ dump, warnings: [], sessions });

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

export const test_resident_graph_source_serializes_lifecycle = async () => {
  const root = GraphPaths.createTempDirectory("samchon-graph-resident-queue-");
  fs.writeFileSync(path.join(root, "a.ts"), "export const a = 1;\n");

  // Like TtscGraphSession.graph(), every caller owns a result promise while the
  // expensive work itself occupies one queue lane. Two first callers must not
  // start two resident language servers.
  const firstBuild = deferred<IIndexerResult>();
  let builds = 0;
  const queued = createResidentGraphSource(
    { cwd: root, languages: [] },
    {
      buildLspGraph: async () => {
        builds += 1;
        return firstBuild.promise;
      },
    } as ResidentDependencies,
  );
  const firstCall = queued.load();
  const secondCall = queued.load();
  await new Promise((resolve) => setTimeout(resolve, 0));
  TestValidator.equals("concurrent first loads start one build", builds, 1);
  const firstDump = emptyDump(root);
  firstBuild.resolve(resultOf(firstDump));
  const [first, second] = await Promise.all([firstCall, secondCall]);
  TestValidator.predicate("queued callers share the unchanged dump", first === second);
  await queued.close();

  // The snapshot published with a build must describe the text that build
  // actually indexed, not whatever happens to be on disk after its final
  // await. An edit in that window must make the next load refresh instead of
  // blessing an old graph with the new file's hash.
  const racedBuild = deferred<void>();
  const releaseRacedBuild = deferred<void>();
  const racedPath = path.join(root, "raced.ts");
  const indexedText = "export const raced = 1;\n";
  fs.writeFileSync(racedPath, indexedText);
  const raced = createResidentGraphSource(
    { cwd: root, languages: ["typescript"] },
    {
      buildLspGraph: async () => {
        racedBuild.resolve();
        await releaseRacedBuild.promise;
        return {
          ...resultOf({
            ...emptyDump(root),
            languages: ["typescript"],
          }),
          sources: new Map([[racedPath, indexedText]]),
        } as IIndexerResult & { sources: Map<string, string> };
      },
    } as ResidentDependencies,
  );
  const racedFirstLoad = raced.load();
  await racedBuild.promise;
  fs.writeFileSync(racedPath, "export const raced = 2;\n");
  releaseRacedBuild.resolve();
  const racedFirst = await racedFirstLoad;
  const racedSecond = await raced.load();
  TestValidator.predicate(
    "an edit during build remains stale for the next load",
    racedSecond !== racedFirst,
  );
  await raced.close();

  // A rejected lane must not poison the queue. The next call retries the build
  // instead of replaying the first failure forever.
  let attempts = 0;
  const retrying = createResidentGraphSource(
    { cwd: root, languages: [] },
    {
      buildLspGraph: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("transient resident build failure");
        return { dump: emptyDump(root), warnings: [] };
      },
    } as ResidentDependencies,
  );
  await rejects(retrying.load(), "the first build failure propagates");
  await retrying.load();
  TestValidator.equals("a later call retries a failed build", attempts, 2);
  await retrying.close();

  // Once a successful builder hands live sessions to the resident source, a
  // later failure while publishing its disk snapshot must close them. Mutating
  // the options after the dependency receives its copy deterministically makes
  // the snapshot boundary fail without involving a real LSP process.
  let abandonedCloseCalls = 0;
  const abandonedSession = {
    client: {
      close: async () => {
        abandonedCloseCalls += 1;
      },
    },
  } as ILspSession;
  const brokenOptions: {
    cwd: string;
    languages?: [];
  } = { cwd: root, languages: [] };
  const abandoned = createResidentGraphSource(brokenOptions, {
    buildLspGraph: async () => {
      Object.defineProperty(brokenOptions, "languages", {
        configurable: true,
        get: () => {
          throw new Error("snapshot boundary failure");
        },
      });
      return resultOf(
        emptyDump(root),
        new Map([["typescript", abandonedSession]]),
      );
    },
  } as ResidentDependencies);
  await rejects(abandoned.load(), "a snapshot publication failure propagates");
  TestValidator.equals(
    "a publication failure closes handed-off sessions",
    abandonedCloseCalls,
    1,
  );

  // A failed shutdown must not strand later sessions in the map. close() keeps
  // disposing them all, then rejects with the first normalized Error.
  let laterCloseCalls = 0;
  const closeFailure = createResidentGraphSource(
    { cwd: root, languages: [] },
    {
      buildLspGraph: async () =>
        resultOf(
          emptyDump(root),
          new Map([
            [
              "typescript",
              {
                client: {
                  close: async () => Promise.reject("first close failed"),
                },
              } as ILspSession,
            ],
            [
              "python",
              {
                client: {
                  close: async () => {
                    laterCloseCalls += 1;
                  },
                },
              } as ILspSession,
            ],
          ]),
        ),
    } as ResidentDependencies,
  );
  await closeFailure.load();
  await rejects(closeFailure.close(), "close reports its first shutdown failure");
  TestValidator.equals(
    "one failed shutdown does not skip later sessions",
    laterCloseCalls,
    1,
  );

  // close() can arrive while the initial build is awaiting the LSP. The session
  // returned by that in-flight build must be closed, its caller must not receive
  // a graph from a dead source, and queued/future calls must never respawn it.
  const loadingBuild = deferred<IIndexerResult>();
  let closeCalls = 0;
  let closeBuilds = 0;
  const session = {
    client: {
      close: async () => {
        closeCalls += 1;
      },
    },
  } as ILspSession;
  const closing = createResidentGraphSource(
    { cwd: root, languages: [] },
    {
      buildLspGraph: async () => {
        closeBuilds += 1;
        return loadingBuild.promise;
      },
    } as ResidentDependencies,
  );
  const loading = closing.load();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const closed = closing.close();
  loadingBuild.resolve(
    resultOf(emptyDump(root), new Map([["typescript", session]])),
  );
  await rejects(loading, "close during load rejects the in-flight caller");
  await closed;
  TestValidator.equals("close during load disposes the returned session", closeCalls, 1);
  await rejects(closing.load(), "a closed source rejects later loads");
  TestValidator.equals("a closed source never rebuilds", closeBuilds, 1);

  // Two calls that observe the same edited snapshot serialize. The first one
  // refreshes it and the second reuses that new dump instead of racing another
  // refresh against the same live LSP session.
  const stale = createResidentGraphSource(
    { cwd: root, languages: ["typescript"] },
    {
      buildLspGraph: async () =>
        resultOf({ ...emptyDump(root), languages: ["typescript"] }),
    } as ResidentDependencies,
  );
  const beforeEdit = await stale.load();
  fs.writeFileSync(path.join(root, "a.ts"), "export const a = 2;\n");
  const [afterEdit, sameEdit] = await Promise.all([stale.load(), stale.load()]);
  TestValidator.predicate("an edit replaces the dump identity", afterEdit !== beforeEdit);
  TestValidator.predicate("concurrent stale loads share one refreshed dump", afterEdit === sameEdit);
  await stale.close();

  // A resident source cannot freeze the language/session partition from its
  // first build. Empty -> first language, adding a static fallback beside a
  // live LSP language, and deleting that LSP language all require a complete
  // fresh build. The replacement is published only after it succeeds, and the
  // old sessions are retired only after the atomic swap.
  const changingRoot = GraphPaths.createTempDirectory("samchon-graph-resident-languages-");
  let changingBuilds = 0;
  let failChangingBuild = false;
  let failHybridRetirement = true;
  const closedBuilds: number[] = [];
  const changing = createResidentGraphSource(
    { cwd: changingRoot },
    {
      buildLspGraph: async () => {
        changingBuilds += 1;
        const build = changingBuilds;
        if (failChangingBuild) {
          failChangingBuild = false;
          throw new Error("fresh language-set build failed");
        }
        const files = fs
          .readdirSync(changingRoot)
          .filter((file) => /\.(?:ts|py|dart)$/.test(file));
        const languages = [
          ...(files.some((file) => file.endsWith(".ts"))
            ? (["typescript"] as const)
            : []),
          ...(files.some((file) => file.endsWith(".py"))
            ? (["python"] as const)
            : []),
          ...(files.some((file) => file.endsWith(".dart"))
            ? (["dart"] as const)
            : []),
        ];
        const sessions = new Map();
        if (languages.includes("typescript")) {
          sessions.set("typescript", {
            client: {
              close: async () => {
                closedBuilds.push(build);
                if (build === 3 && failHybridRetirement) {
                  failHybridRetirement = false;
                  throw new Error("old hybrid session shutdown failed");
                }
              },
            },
          } as ILspSession);
        }
        return {
          dump: {
            ...emptyDump(changingRoot),
            languages,
            indexer:
              sessions.size > 0 && languages.length > sessions.size
                ? "hybrid"
                : sessions.size > 0
                  ? "lsp"
                  : "static",
          },
          warnings: [],
          sessions,
          sources: new Map(
            files.map((file) => {
              const absolute = path.join(changingRoot, file);
              return [absolute, fs.readFileSync(absolute, "utf8")];
            }),
          ),
        } satisfies IIndexerResult;
      },
    } as ResidentDependencies,
  );

  const noLanguages = await changing.load();
  TestValidator.equals("resident source starts from an empty language set", noLanguages.languages, []);
  fs.writeFileSync(path.join(changingRoot, "first.ts"), "export const first = 1;\n");
  const firstLanguage = await changing.load();
  TestValidator.equals(
    "adding the first language replaces the empty resident state",
    firstLanguage.languages,
    ["typescript"],
  );
  fs.writeFileSync(path.join(changingRoot, "fallback.py"), "value = 1\n");
  const hybrid = await changing.load();
  TestValidator.predicate(
    "adding a static language rebuilds the live/static partition",
    hybrid.indexer === "hybrid" &&
      hybrid.languages.includes("typescript") &&
      hybrid.languages.includes("python") &&
      closedBuilds.includes(2),
  );
  fs.rmSync(path.join(changingRoot, "first.ts"));
  await rejects(
    changing.load(),
    "an old-session close failure is reported after the fresh state is swapped",
  );
  const staticOnly = await changing.load();
  TestValidator.predicate(
    "deleting the live language retires its session and keeps the fallback",
    staticOnly.indexer === "static" &&
      staticOnly.languages.length === 1 &&
      staticOnly.languages[0] === "python" &&
      closedBuilds.includes(3),
  );

  fs.writeFileSync(path.join(changingRoot, "new.dart"), "class NewLanguage {}\n");
  failChangingBuild = true;
  await rejects(
    changing.load(),
    "a failed language-set replacement propagates without swapping state",
  );
  fs.rmSync(path.join(changingRoot, "new.dart"));
  const afterFailedReplacement = await changing.load();
  TestValidator.predicate(
    "the prior state remains usable after a failed fresh build",
    afterFailedReplacement === staticOnly,
  );
  TestValidator.equals(
    "language-set changes invoke one fresh build per attempted transition",
    changingBuilds,
    5,
  );
  await changing.close();

  // startServer owns the dump-to-memory cache. An unchanged dump must retain the
  // exact SamchonGraphMemory object; only a replacement dump creates a new one.
  const startServer = (await import(
    pathToFileURL(
      path.join(
        GraphPaths.graphPackageRoot,
        "lib",
        "mcp",
        "createResidentGraphMemorySource.js",
      ),
    ).href
  )) as ResidentMemoryModule;
  const dumpA = emptyDump(root);
  const dumpB = emptyDump(root);
  let memoryLoads = 0;
  const memorySource = startServer.createResidentGraphMemorySource({
    async load() {
      memoryLoads += 1;
      return memoryLoads < 3 ? dumpA : dumpB;
    },
    modes: () => new Map(),
    async close() {},
  });
  const memoryA = await memorySource();
  const unchangedMemory = await memorySource();
  const memoryB = await memorySource();
  TestValidator.predicate(
    "an unchanged dump reuses SamchonGraphMemory identity",
    memoryA === unchangedMemory,
  );
  TestValidator.predicate(
    "a changed dump replaces SamchonGraphMemory identity",
    memoryB !== unchangedMemory,
  );
};
