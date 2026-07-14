import { ISamchonGraphEdge, ISamchonGraphNode } from "../structures";
import { projectRelative, readText } from "../utils/fs";
import { languageOf } from "./languages";
import { reexportsOf } from "./reexportsOf";
import { resolveModuleFile } from "./resolveModuleFile";

/**
 * The `exports` edges: one per module that puts a symbol on the wire.
 *
 * `@ttsc/graph` reads them off the checker's export table, which has already
 * followed every re-export and barrel. Here they are derived from the export
 * syntax itself (§4k), and the chain is followed the same way: a barrel that
 * re-exports a barrel forwards what that one forwards, so the name a consumer
 * imports from the package carries an edge from every file above it and an
 * internal helper carries the one from the file that declares it.
 *
 * That count is what {@link exportFanIn} reads, and the whole reason the tour's
 * centrality is a product rather than a flag: a ranker that knew only `exported`
 * saw a package's front door and its legacy subpath as equally public.
 */
export function exportEdges(
  root: string,
  files: readonly string[],
  nodes: readonly ISamchonGraphNode[],
): ISamchonGraphEdge[] {
  const relFiles = new Set(files.map((abs) => projectRelative(root, abs)));
  const absByRel = new Map(
    files.map((abs) => [projectRelative(root, abs), abs] as const),
  );

  // What each file declares and publishes itself: the base of every chain.
  const declared = new Map<string, ISamchonGraphNode[]>();
  for (const node of nodes) {
    if (node.external || node.file === "" || node.exported !== true) continue;
    const bucket = declared.get(node.file);
    if (bucket === undefined) declared.set(node.file, [node]);
    else bucket.push(node);
  }

  // Which files each file forwards from, and under which names.
  const forwards = new Map<
    string,
    Array<{ target: string; names?: string[] }>
  >();
  for (const rel of relFiles) {
    const abs = absByRel.get(rel)!;
    const text = readText(abs);
    /* c8 ignore next */
    if (text === undefined) continue;
    const language = languageOf(abs);
    const out: Array<{ target: string; names?: string[] }> = [];
    for (const reexport of reexportsOf(language, rel, text)) {
      const target = resolveModuleFile(
        language,
        rel,
        reexport.specifier,
        relFiles,
      );
      if (target === undefined || target === rel) continue;
      out.push({
        target,
        ...(reexport.names !== undefined ? { names: reexport.names } : {}),
      });
    }
    if (out.length > 0) forwards.set(rel, out);
  }

  // A barrel re-exporting a barrel is a chain, so the surface is the closure —
  // memoized, and guarded against a cycle (two files that re-export each other
  // is legal and must not hang the index).
  const surfaces = new Map<string, ISamchonGraphNode[]>();
  const walking = new Set<string>();
  const surfaceOf = (file: string): ISamchonGraphNode[] => {
    const known = surfaces.get(file);
    if (known !== undefined) return known;
    if (walking.has(file)) return [];
    walking.add(file);
    const seen = new Set<string>();
    const out: ISamchonGraphNode[] = [];
    const take = (node: ISamchonGraphNode): void => {
      if (seen.has(node.id)) return;
      seen.add(node.id);
      out.push(node);
    };
    for (const node of declared.get(file) ?? []) take(node);
    for (const forward of forwards.get(file) ?? []) {
      for (const node of surfaceOf(forward.target)) {
        if (forward.names !== undefined && !forward.names.includes(node.name))
          continue;
        take(node);
      }
    }
    walking.delete(file);
    surfaces.set(file, out);
    return out;
  };

  const edges: ISamchonGraphEdge[] = [];
  for (const rel of relFiles) {
    for (const node of surfaceOf(rel)) {
      edges.push({ from: rel, to: node.id, kind: "exports" });
    }
  }
  return edges;
}
