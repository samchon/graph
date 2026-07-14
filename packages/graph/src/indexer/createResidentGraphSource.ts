import { createHash } from "node:crypto";
import path from "node:path";
import {
  ISamchonGraphDiagnostic,
  ISamchonGraphDump,
  ISamchonGraphEdge,
  ISamchonGraphNode,
} from "../structures";
import { GraphLanguage } from "../typings";
import { readText, walkSourceFiles } from "../utils/fs";
import { allExtensions } from "./allExtensions";
import { buildLspGraph } from "./buildLspGraph";
import { staticGraphParts } from "./staticGraphParts";
import { dedupeEdges } from "./dedupeEdges";
import { dedupeNodes } from "./dedupeNodes";
import { finalizeGraph } from "./finalizeGraph";
import { IBuildGraphOptions } from "./IBuildGraphOptions";
import { ILspSession } from "./ILspSession";
import { IResidentGraphSource } from "./IResidentGraphSource";
import { refreshLanguageSession } from "./refreshLanguageSession";
import { wireEdges } from "./wireEdges";
import { wireNodes } from "./wireNodes";

// Languages that fell back to static parsing (no LSP session to hold) are
// simply re-parsed from scratch on every refresh; `buildStaticGraph` has no
// warm state to lose, so there is nothing to reuse there.
export function createResidentGraphSource(
  options: IBuildGraphOptions = {},
): IResidentGraphSource {
  const root = path.resolve(options.cwd ?? process.cwd());
  let state:
    | {
        dump: ISamchonGraphDump;
        sessions: Map<GraphLanguage, ILspSession>;
        staticLanguages: GraphLanguage[];
        hashes: Map<string, string>;
      }
    | undefined;

  async function buildFresh(): Promise<void> {
    // `keepAlive: true` above guarantees `buildLspGraph` always returns a
    // sessions map, even an empty one.
    const result = await buildLspGraph({ ...options, keepAlive: true });
    const sessions = result.sessions!;
    const staticLanguages = staticLanguagesOf(result.dump, sessions);
    state = {
      dump: result.dump,
      sessions,
      staticLanguages,
      hashes: snapshotSources(root, options),
    };
  }

  async function refreshStale(current: NonNullable<typeof state>): Promise<void> {
    const nodes: ISamchonGraphNode[] = [];
    const edges: ISamchonGraphEdge[] = [];
    // Rebuilt from what the servers say now, exactly like the nodes and the
    // edges. Carrying the previous dump's array forward made `diagnostics` a
    // function of the session's edit history — a deleted file's findings survived
    // forever, a re-analysed file's were duplicated on every refresh — inside a
    // dump whose own contract is that it is a function of its source (§6a). The
    // session holds them per file now, and a `didClose` drops the file's.
    const diagnostics: ISamchonGraphDiagnostic[] = [];
    const warnings: string[] = [];

    for (const [language, session] of current.sessions) {
      const files = walkSourceFiles(root, {
        extensions: allExtensions([language]),
        maxFiles: options.maxFiles,
      });
      const result = await refreshLanguageSession(session, files, options);
      nodes.push(...result.nodes);
      edges.push(...result.edges);
      diagnostics.push(...result.diagnostics);
      warnings.push(...result.warnings);
    }
    if (current.staticLanguages.length > 0) {
      const fallback = staticGraphParts({
        ...options,
        cwd: root,
        mode: "static",
        languages: current.staticLanguages,
      });
      nodes.push(...fallback.nodes);
      edges.push(...fallback.edges);
      warnings.push(...fallback.warnings);
    }

    const finalized = finalizeGraph(
      root,
      walkSourceFiles(root, {
        extensions: allExtensions(options.languages),
        maxFiles: options.maxFiles,
      }),
      nodes,
      edges,
    );
    current.dump = {
      ...current.dump,
      nodes: wireNodes(dedupeNodes(finalized.nodes)),
      edges: wireEdges(dedupeEdges(finalized.edges)),
      diagnostics,
      warnings,
    };
    current.hashes = snapshotSources(root, options);
  }

  return {
    async load(): Promise<ISamchonGraphDump> {
      if (state === undefined) {
        await buildFresh();
        return state!.dump;
      }
      if (isStale(state.hashes, root, options)) await refreshStale(state);
      return state.dump;
    },
    async close(): Promise<void> {
      if (state === undefined) return;
      for (const session of state.sessions.values()) await session.client.close();
    },
  };
}

// A language ended up in the static fallback if the dump reports it but no
// live session was returned for it (an LSP session is only kept for a
// language that actually produced real symbols).
function staticLanguagesOf(
  dump: ISamchonGraphDump,
  sessions: Map<GraphLanguage, ILspSession>,
): GraphLanguage[] {
  return dump.languages.filter(
    (language) => !sessions.has(language as GraphLanguage),
  ) as GraphLanguage[];
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
): Map<string, string> {
  const files = walkSourceFiles(root, {
    extensions: allExtensions(options.languages),
    maxFiles: options.maxFiles,
  });
  const snapshot = new Map<string, string>();
  for (const abs of files) {
    const text = readText(abs);
    // A file removed between the walk and the read is simply absent from the
    // snapshot, which itself is a difference the next comparison will catch.
    /* c8 ignore next */
    if (text === undefined) continue;
    snapshot.set(abs, createHash("sha256").update(text).digest("hex"));
  }
  return snapshot;
}

function isStale(
  previous: Map<string, string>,
  root: string,
  options: IBuildGraphOptions,
): boolean {
  const current = snapshotSources(root, options);
  if (current.size !== previous.size) return true;
  for (const [file, hash] of current) {
    if (previous.get(file) !== hash) return true;
  }
  return false;
}
