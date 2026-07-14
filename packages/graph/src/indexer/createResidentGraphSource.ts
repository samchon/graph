import fs from "node:fs";
import path from "node:path";
import { ISamchonGraphDump, ISamchonGraphEdge, ISamchonGraphNode } from "../structures";
import { GraphLanguage } from "../typings";
import { walkSourceFiles } from "../utils/fs";
import { allExtensions } from "./allExtensions";
import { buildLspGraph } from "./buildLspGraph";
import { staticGraphParts } from "./buildStaticGraph";
import { dedupeEdges } from "./dedupeEdges";
import { dedupeNodes } from "./dedupeNodes";
import { finalizeGraph } from "./finalizeGraph";
import { IBuildGraphOptions } from "./IBuildGraphOptions";
import { ILspSession } from "./ILspSession";
import { IResidentGraphSource } from "./IResidentGraphSource";
import { refreshLanguageSession } from "./refreshLanguageSession";
import { wireEdges, wireNodes } from "./wireSpans";

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
        mtimes: Map<string, number>;
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
      mtimes: snapshotMtimes(root, options),
    };
  }

  async function refreshStale(current: NonNullable<typeof state>): Promise<void> {
    const nodes: ISamchonGraphNode[] = [];
    const edges: ISamchonGraphEdge[] = [];
    const diagnostics = [...current.dump.diagnostics!];
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
    current.mtimes = snapshotMtimes(root, options);
  }

  return {
    async load(): Promise<ISamchonGraphDump> {
      if (state === undefined) {
        await buildFresh();
        return state!.dump;
      }
      if (isStale(state.mtimes, root, options)) await refreshStale(state);
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

function snapshotMtimes(
  root: string,
  options: IBuildGraphOptions,
): Map<string, number> {
  const files = walkSourceFiles(root, {
    extensions: allExtensions(options.languages),
    maxFiles: options.maxFiles,
  });
  const snapshot = new Map<string, number>();
  for (const abs of files) {
    // A file removed between the walk and the stat is simply absent from the
    // snapshot, which itself is a difference the next comparison will catch.
    /* c8 ignore start */
    try {
      snapshot.set(abs, fs.statSync(abs).mtimeMs);
    } catch {
      // ignored -- see comment above
    }
    /* c8 ignore stop */
  }
  return snapshot;
}

function isStale(
  previous: Map<string, number>,
  root: string,
  options: IBuildGraphOptions,
): boolean {
  const current = snapshotMtimes(root, options);
  if (current.size !== previous.size) return true;
  for (const [file, mtime] of current) {
    if (previous.get(file) !== mtime) return true;
  }
  return false;
}
