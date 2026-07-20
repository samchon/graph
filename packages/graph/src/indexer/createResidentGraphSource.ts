import { createHash } from "node:crypto";
import path from "node:path";
import {
  ISamchonGraphDiagnostic,
  ISamchonGraphDump,
  ISamchonGraphEdge,
  ISamchonGraphNode,
} from "../structures";
import { GraphLanguage } from "../typings";
import { SamchonGraphSourceReader } from "../SamchonGraphSourceReader";
import { IBulkGraphSession } from "../provider/IBulkGraphSession";
import { isBulkGraphSession } from "../provider/isBulkGraphSession";
import { mergeGraphSlices } from "../provider/mergeGraphSlices";
import { readText } from "../utils/fs";
import { buildLspGraph } from "./buildLspGraph";
import { buildStaticGraphResult } from "./buildStaticGraphResult";
import { staticGraphParts } from "./staticGraphParts";
import { discoverLanguages } from "./discoverLanguages";
import { IBuildGraphOptions } from "./IBuildGraphOptions";
import { ILspSession } from "./ILspSession";
import { IResidentGraphSource } from "./IResidentGraphSource";
import { languageOf } from "./languageOf";
import { refreshLanguageSession } from "./refreshLanguageSession";
import { IGraphSourceSelection } from "./IGraphSourceSelection";
import { selectGraphSources } from "./selectGraphSources";
import { wireEdges } from "./wireEdges";
import { wireNodes } from "./wireNodes";

interface IResidentState {
  dump: ISamchonGraphDump;
  sessions: Map<GraphLanguage, ILspSession | IBulkGraphSession>;
  generations: Map<GraphLanguage, number>;
  staticLanguages: GraphLanguage[];
  languages: GraphLanguage[];
  hashes: Map<string, string>;
  source: SamchonGraphSourceReader;
}

interface IResidentDependencies {
  buildLspGraph: typeof buildLspGraph;
  buildStaticGraphResult?: typeof buildStaticGraphResult;
}

const DEFAULT_DEPENDENCIES: IResidentDependencies = {
  buildLspGraph,
  buildStaticGraphResult,
};

// Languages that fell back to static parsing (no LSP session to hold) are
// simply re-parsed from scratch on every refresh; `buildStaticGraph` has no
// warm state to lose, so there is nothing to reuse there.
export function createResidentGraphSource(
  options: IBuildGraphOptions = {},
  dependencies: IResidentDependencies = DEFAULT_DEPENDENCIES,
): IResidentGraphSource {
  const root = path.resolve(options.cwd ?? process.cwd());
  let state: IResidentState | undefined;
  let queue: Promise<void> = Promise.resolve();
  let closed = false;
  let activeAbort: AbortController | undefined;
  let closing: Promise<void> | undefined;
  const sessionClosures = new WeakMap<
    ILspSession | IBulkGraphSession,
    Promise<void>
  >();

  async function buildFresh(signal: AbortSignal): Promise<IResidentState> {
    // `keepAlive: true` above guarantees `buildLspGraph` always returns a
    // sessions map, even an empty one.
    const result =
      options.mode === "static"
        ? (dependencies.buildStaticGraphResult ?? buildStaticGraphResult)(
            options,
          )
        : await dependencies.buildLspGraph({
            ...options,
            keepAlive: true,
            signal,
          });
    const sessions = result.sessions ?? new Map();
    try {
      const texts = result.sources ?? new Map<string, string>();
      return {
        dump: result.dump,
        sessions,
        generations: bulkGenerationsOf(sessions),
        staticLanguages: staticLanguagesOf(result.dump, sessions),
        languages: languagesOf(result.sources, root, options, sessions),
        hashes:
          result.sources === undefined
            ? snapshotSources(root, options, bulkLanguagesOf(sessions))
            : hashSources(result.sources),
        source: result.source ?? sourceReaderOf(root, texts, sessions),
      };
    } catch (error) {
      // Once the build hands its sessions to this source, every later failure
      // on the path to publishing the state belongs to us to clean up.
      await closeSessions(sessions, sessionClosures);
      throw error;
    }
  }

  async function refreshStale(
    current: IResidentState,
    prefetched: ReadonlyMap<GraphLanguage, IBulkGraphSession.IRefresh>,
    signal: AbortSignal,
  ): Promise<void> {
    const nodes: ISamchonGraphNode[] = [];
    const edges: ISamchonGraphEdge[] = [];
    const strictNodes: ISamchonGraphNode[] = [];
    const strictEdges: ISamchonGraphEdge[] = [];
    // Rebuilt from what the servers say now, exactly like the nodes and the
    // edges. Carrying the previous dump's array forward made `diagnostics` a
    // function of the session's edit history — a deleted file's findings survived
    // forever, a re-analysed file's were duplicated on every refresh — inside a
    // dump whose own contract is that it is a function of its source (§6a). The
    // session holds them per file now, and a `didClose` drops the file's.
    const diagnostics: ISamchonGraphDiagnostic[] = [];
    const warnings: string[] = [];
    const sources = new Map<string, string>();
    const generations = new Map(current.generations);
    const selected = selectGraphSources(root, options);

    for (const [language, session] of current.sessions) {
      if (isBulkGraphSession(session)) {
        // `load` refreshes every bulk session through `refreshBulkSessions`
        // before it decides to refresh at all, and hands those results here as
        // `prefetched`. Both loops walk the same `state.sessions` map, which is
        // never mutated in place, so a bulk session reached here is always one
        // that was already prefetched — its snapshot is present without a second
        // (double-counting) refresh.
        const refresh = prefetched.get(language)!;
        assertOpen();
        strictNodes.push(...refresh.snapshot.nodes);
        strictEdges.push(...refresh.snapshot.edges);
        // Rebuilt from what the compiler says now, exactly like the nodes and
        // the edges, and for the same reason the LSP lane stopped carrying them
        // forward: a diagnostic belongs to the generation that produced it.
        diagnostics.push(...refresh.snapshot.diagnostics);
        warnings.push(...refresh.snapshot.warnings);
        generations.set(language, refresh.generation);
        continue;
      }
      // `sameLanguages` only admits this refresh while discovery still sees
      // every live session language in the selected source snapshot.
      const files = selected.byLanguage.get(language)!;
      const result = await refreshLanguageSession(
        session,
        files,
        options,
        signal,
      );
      assertOpen();
      nodes.push(...result.nodes);
      edges.push(...result.edges);
      diagnostics.push(...result.diagnostics);
      warnings.push(...result.warnings);
      for (const opened of session.opened.values()) {
        sources.set(opened.abs, opened.text);
      }
    }
    if (current.staticLanguages.length > 0) {
      const fallback = staticGraphParts(
        {
          ...options,
          cwd: root,
          mode: "static",
          languages: current.staticLanguages,
        },
        filesForLanguages(selected, current.staticLanguages),
      );
      nodes.push(...fallback.nodes);
      edges.push(...fallback.edges);
      warnings.push(...fallback.warnings);
      for (const [file, text] of fallback.sources) sources.set(file, text);
    }

    const finalized = mergeGraphSlices({
      root,
      // Bulk slices already contain compiler-resolved export edges. Reopening
      // their manifest would break snapshot ownership and can target virtual or
      // external identities; only generic source text belongs in this pass.
      files: [...sources.keys()],
      genericNodes: nodes,
      genericEdges: edges,
      strictNodes,
      strictEdges,
    });
    const dump: ISamchonGraphDump = {
      ...current.dump,
      nodes: wireNodes(finalized.nodes),
      edges: wireEdges(finalized.edges),
      diagnostics,
      warnings,
    };
    current.dump = dump;
    current.hashes = hashSources(sources);
    current.generations = generations;
    current.source = sourceReaderOf(root, sources, current.sessions);
  }

  async function replaceLanguages(
    current: IResidentState,
    signal: AbortSignal,
  ): Promise<void> {
    const fresh = await buildFresh(signal);
    if (closed) {
      await closeSessions(fresh.sessions, sessionClosures);
      throw closedError();
    }
    // Publish the complete replacement atomically before retiring the old
    // sessions. A failed fresh build leaves `current` untouched; a failed old
    // shutdown leaves the newly built state usable on the next call.
    state = fresh;
    await closeSessions(current.sessions, sessionClosures);
  }

  return {
    load(): Promise<ISamchonGraphDump> {
      return enqueue(async () => {
        assertOpen();
        const controller = new AbortController();
        activeAbort = controller;
        try {
          if (state === undefined) {
            const fresh = await buildFresh(controller.signal);
            if (closed) {
              await closeSessions(fresh.sessions, sessionClosures);
              throw closedError();
            }
            state = fresh;
          } else {
            const prefetched = await refreshBulkSessions(
              state.sessions,
              controller.signal,
            );
            const bulkChanged = [...prefetched].some(
              ([language, refresh]) =>
                state!.generations.get(language) !== refresh.generation,
            );
            if (
              bulkChanged ||
              isStale(
                state.hashes,
                root,
                options,
                bulkLanguagesOf(state.sessions),
              )
            ) {
              const discovered = discoverLanguages(root, options);
              if (sameLanguages(state.languages, discovered)) {
                await refreshStale(state, prefetched, controller.signal);
              } else {
                await replaceLanguages(state, controller.signal);
              }
            }
          }
          assertOpen();
          return state.dump;
        } finally {
          if (activeAbort === controller) activeAbort = undefined;
        }
      });
    },
    source(): SamchonGraphSourceReader | undefined {
      return state?.source;
    },
    close(): Promise<void> {
      if (closing !== undefined) return closing;
      // Flip the bit synchronously. A load already inside an await observes it
      // before publishing a newly-built/refreshed graph, while calls queued
      // behind this point never start another language server.
      closed = true;
      activeAbort?.abort();
      const current = state;
      const immediateBulkClose =
        current === undefined
          ? Promise.resolve()
          : closeSessions(current.sessions, sessionClosures, true);
      closing = (async () => {
        let failure: Error | undefined;
        try {
          await immediateBulkClose;
        } catch (error) {
          failure = asError(error);
        }
        try {
          await enqueue(async () => {
            const final = state;
            state = undefined;
            if (final !== undefined) {
              await closeSessions(final.sessions, sessionClosures);
            }
          });
        } catch (error) {
          failure ??= asError(error);
        }
        if (failure !== undefined) throw failure;
      })();
      return closing;
    },
  };

  /** One queue lane per public call, without caching a rejected lane. */
  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    let resolveResult!: (value: T) => void;
    let rejectResult!: (error: Error) => void;
    const result = new Promise<T>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    queue = queue
      .catch(() => undefined)
      .then(async () => {
        try {
          resolveResult(await task());
        } catch (error) {
          rejectResult(asError(error));
        }
      });
    return result;
  }

  function assertOpen(): void {
    if (closed) throw closedError();
  }
}

function sourceReaderOf(
  root: string,
  texts: ReadonlyMap<string, string>,
  sessions: ReadonlyMap<GraphLanguage, ILspSession | IBulkGraphSession>,
): SamchonGraphSourceReader {
  const digests = new Map<string, IBulkGraphSession.ISourceDigest>();
  for (const session of sessions.values()) {
    if (!isBulkGraphSession(session)) continue;
    for (const [file, digest] of session.current?.sources ?? []) {
      digests.set(file, digest);
    }
  }
  return new SamchonGraphSourceReader(root, { texts, digests });
}

function languagesOf(
  sources: ReadonlyMap<string, string> | undefined,
  root: string,
  options: IBuildGraphOptions,
  sessions: ReadonlyMap<GraphLanguage, ILspSession | IBulkGraphSession>,
): GraphLanguage[] {
  const discovered =
    sources === undefined
      ? discoverLanguages(root, options)
      : [...sources.keys()]
          .map(languageOf)
          .filter((language) => language !== "unknown");
  return [
    ...new Set([...discovered, ...sessions.keys()]),
  ];
}

function sameLanguages(
  left: readonly GraphLanguage[],
  right: readonly GraphLanguage[],
): boolean {
  return (
    left.length === right.length &&
    left.every((language) => right.includes(language))
  );
}

function closedError(): Error {
  return new Error("@samchon/graph: resident graph source is closed");
}

async function closeSessions(
  sessions: Map<GraphLanguage, ILspSession | IBulkGraphSession>,
  closures: WeakMap<ILspSession | IBulkGraphSession, Promise<void>>,
  bulkOnly = false,
): Promise<void> {
  let failure: Error | undefined;
  for (const session of sessions.values()) {
    if (bulkOnly && !isBulkGraphSession(session)) continue;
    try {
      let closure = closures.get(session);
      if (closure === undefined) {
        closure = isBulkGraphSession(session)
          ? session.close()
          : session.client.close();
        closures.set(session, closure);
      }
      await closure;
    } catch (error) {
      // Close every resident process even when one shutdown handshake fails.
      failure ??= asError(error);
    }
  }
  if (failure !== undefined) throw failure;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

// A language ended up in the static fallback if the dump reports it but no
// live session was returned for it (an LSP session is only kept for a
// language that actually produced real symbols).
function staticLanguagesOf(
  dump: ISamchonGraphDump,
  sessions: Map<GraphLanguage, ILspSession | IBulkGraphSession>,
): GraphLanguage[] {
  return dump.languages.filter(
    (language) => !sessions.has(language as GraphLanguage),
  ) as GraphLanguage[];
}

function bulkGenerationsOf(
  sessions: ReadonlyMap<GraphLanguage, ILspSession | IBulkGraphSession>,
): Map<GraphLanguage, number> {
  const generations = new Map<GraphLanguage, number>();
  for (const [language, session] of sessions) {
    if (isBulkGraphSession(session)) {
      generations.set(language, session.generation);
    }
  }
  return generations;
}

async function refreshBulkSessions(
  sessions: ReadonlyMap<GraphLanguage, ILspSession | IBulkGraphSession>,
  signal?: AbortSignal,
): Promise<Map<GraphLanguage, IBulkGraphSession.IRefresh>> {
  const refreshed = new Map<GraphLanguage, IBulkGraphSession.IRefresh>();
  for (const [language, session] of sessions) {
    if (isBulkGraphSession(session)) {
      refreshed.set(language, await session.refresh({ signal }));
    }
  }
  return refreshed;
}

function bulkLanguagesOf(
  sessions: ReadonlyMap<GraphLanguage, ILspSession | IBulkGraphSession>,
): ReadonlySet<GraphLanguage> {
  const languages = new Set<GraphLanguage>();
  for (const [language, session] of sessions) {
    if (isBulkGraphSession(session)) languages.add(language);
  }
  return languages;
}

/**
 * What every source file on disk contains right now, as a content hash per file.
 *
 * The audit that rides on every result says the facts were resolved "for the
 * snapshot this call synced to", and that sentence is only true if the server
 * can actually tell that the snapshot moved. A timestamp cannot: a same-tick
 * edit — an editor writing a file twice inside one clock resolution, a script
 * rewriting a file to the same length — leaves the mtime where it was, and the
 * graph then answers a question about code that no longer exists while swearing
 * it is current (§1c).
 *
 * So freshness is the file's content, hashed, and nothing else. It costs one
 * read of each source file per call, which is what the walk already pays, and it
 * cannot be wrong.
 */
function snapshotSources(
  root: string,
  options: IBuildGraphOptions,
  excludedLanguages: ReadonlySet<GraphLanguage> = new Set(),
): Map<string, string> {
  const files = selectGraphSources(root, options).files;
  const snapshot = new Map<string, string>();
  for (const abs of files) {
    if (excludedLanguages.has(languageOf(abs))) continue;
    const text = readText(abs);
    // A file removed between the walk and the read is simply absent from the
    // snapshot, which itself is a difference the next comparison will catch.
    /* c8 ignore next */
    if (text === undefined) continue;
    snapshot.set(abs, createHash("sha256").update(text).digest("hex"));
  }
  return snapshot;
}

function filesForLanguages(
  selected: IGraphSourceSelection,
  languages: readonly GraphLanguage[],
): string[] {
  // Resident static languages came from this source-selection-backed dump, so
  // every partition is present before the fallback is refreshed.
  const allowed = new Set(
    languages.flatMap((language) => selected.byLanguage.get(language)!),
  );
  return selected.files.filter((file) => allowed.has(file));
}

/** Content hashes for the exact texts an index pass consumed. */
function hashSources(
  sources: ReadonlyMap<string, string>,
): Map<string, string> {
  const snapshot = new Map<string, string>();
  for (const [file, text] of sources) {
    snapshot.set(file, createHash("sha256").update(text).digest("hex"));
  }
  return snapshot;
}

function isStale(
  previous: Map<string, string>,
  root: string,
  options: IBuildGraphOptions,
  excludedLanguages: ReadonlySet<GraphLanguage>,
): boolean {
  const current = snapshotSources(root, options, excludedLanguages);
  if (current.size !== previous.size) return true;
  for (const [file, hash] of current) {
    if (previous.get(file) !== hash) return true;
  }
  return false;
}
