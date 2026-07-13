import { SamchonGraphMemory } from "../SamchonGraphMemory";
import { ISamchonGraphNode, ISamchonGraphOverview } from "../structures";
import { dirname } from "../utils/path";
import { isStructural } from "./common";
import { isPublicApiNoisePath } from "./isPublicApiNoisePath";
import { isSupportPath } from "./isSupportPath";

/**
 * Project a compact, source-read-free architecture map: counts by kind, folder
 * layering with export density, the highest-dependency symbols (ranked by real
 * fan-in/out, excluding structural edges so nesting does not masquerade as
 * dependency), and the export surface by file. Output is bounded so a model
 * reads structure cheaply.
 */
export function runOverview(
  graph: SamchonGraphMemory,
  props: ISamchonGraphOverview.IRequest,
): ISamchonGraphOverview {
  const aspect = props.aspect ?? "all";
  const want = (a: ISamchonGraphOverview.IRequest["aspect"]): boolean =>
    aspect === "all" || aspect === a;

  const byKind: Record<string, number> = {};
  let files = 0;
  for (const node of graph.nodes) {
    byKind[node.kind] = (byKind[node.kind] ?? 0) + 1;
    if (node.kind === "file") files++;
  }

  const result: ISamchonGraphOverview = {
    type: "overview",
    project: graph.project,
    counts: {
      files,
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      byKind,
    },
  };
  if (want("layers")) result.layers = layers(graph);
  if (want("hotspots")) result.hotspots = hotspots(graph);
  if (want("publicApi")) result.publicApi = publicApi(graph);
  return result;
}

/** Folder-level layering: how source and its export surface spread by directory. */
function layers(graph: SamchonGraphMemory): ISamchonGraphOverview.ILayer[] {
  const byDir = new Map<string, { files: Set<string>; exported: number }>();
  for (const node of graph.nodes) {
    if (
      node.external ||
      node.ignored ||
      node.kind === "file" ||
      isSupportPath(node.file)
    )
      continue;
    const dir = dirname(node.file);
    let entry = byDir.get(dir);
    if (!entry) {
      entry = { files: new Set(), exported: 0 };
      byDir.set(dir, entry);
    }
    entry.files.add(node.file);
    if (node.exported) entry.exported++;
  }
  return [...byDir.entries()]
    .map(([dir, entry]) => ({
      dir,
      files: entry.files.size,
      exported: entry.exported,
    }))
    .sort((a, b) => b.files - a.files)
    .slice(0, 10);
}

/**
 * The symbols at the center of the dependency graph, ranked by real fan-in and
 * fan-out. Structural `contains`/`exports`/`imports` edges are excluded so the
 * ranking reflects code dependency, not nesting.
 */
function hotspots(
  graph: SamchonGraphMemory,
): ISamchonGraphOverview.IHotspot[] {
  const real = (id: string, side: "in" | "out"): number => {
    const edges = side === "in" ? graph.incoming(id) : graph.outgoing(id);
    let n = 0;
    for (const edge of edges) if (!isStructural(edge.kind)) n++;
    return n;
  };
  return graph.nodes
    .filter(
      (node) =>
        !node.external &&
        !node.ignored &&
        node.kind !== "file" &&
        !isSupportPath(node.file),
    )
    .map((node) => ({
      ...nodeOf(node),
      fanIn: real(node.id, "in"),
      fanOut: real(node.id, "out"),
    }))
    .filter((h) => h.fanIn + h.fanOut > 0)
    .sort((a, b) => b.fanIn + b.fanOut - (a.fanIn + a.fanOut))
    .slice(0, 10);
}

/** Declaration kinds that make up a meaningful public API surface. */
const API_KINDS = new Set<string>([
  "class",
  "interface",
  "function",
  "type",
  "enum",
]);

/**
 * The exported API surface: the exported symbols a consumer of the project
 * would use, ranked by how depended-on each is (real fan-in/out, structural
 * edges excluded). Ranking by dependency rather than by which file declares the
 * most exports surfaces the load-bearing types (a DataSource, a
 * SelectQueryBuilder) instead of whichever file bundles the most type aliases;
 * test, typings, and generated files are dropped so they cannot crowd the real
 * surface out.
 */
function publicApi(
  graph: SamchonGraphMemory,
): ISamchonGraphOverview.IPublicApi[] {
  const degree = (id: string): number => {
    let n = 0;
    for (const edge of graph.outgoing(id))
      if (!isStructural(edge.kind)) n++;
    for (const edge of graph.incoming(id))
      if (!isStructural(edge.kind)) n++;
    return n;
  };
  return graph
    .exported()
    .filter((node) => API_KINDS.has(node.kind) && !isNoiseFile(node.file))
    .map((node) => ({
      node: nodeOf(node),
      degree: degree(node.id),
    }))
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 15)
    .map((ranked) => ranked.node);
}

/**
 * A file whose exports are noise for an architecture overview: a test, a
 * dependency's bundled `.d.ts`/typings, or generated output. The conventions
 * are universal (a `test`/`spec` path, a `typings` file), so excluding them is
 * not framework-specific; it keeps the API surface to authored, used code.
 */
function isNoiseFile(file: string): boolean {
  return isPublicApiNoisePath(file);
}

/** Stable symbol coordinate shared by overview facets. */
function nodeOf(node: ISamchonGraphNode): ISamchonGraphOverview.INode {
  const out: ISamchonGraphOverview.INode = {
    id: node.id,
    name: node.qualifiedName ?? node.name,
    kind: node.kind,
    file: node.file,
  };
  if (node.evidence?.startLine !== undefined) {
    out.line = node.evidence.startLine;
  }
  return out;
}
