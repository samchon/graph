import { SamchonGraphMemory } from "../SamchonGraphMemory";
import { ISamchonGraphNode, ISamchonGraphOverview } from "../structures";
import { GraphLanguage } from "../typings";
import { dirname } from "../utils/path";
import { isStructural, resultGuide, resultNext, summaryOf } from "./common";
import { isPublicApiNoisePath } from "./isPublicApiNoisePath";
import { isSupportPath } from "./isSupportPath";

/** Declaration kinds that make up a meaningful public API surface. */
const API_KINDS = new Set<string>([
  "class",
  "interface",
  "function",
  "type",
  "enum",
]);

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
  return {
    type: "overview",
    project: graph.project,
    languages: graph.languages as ISamchonGraphOverview["languages"],
    counts: counts(graph),
    ...(want("layers") ? { layers: layers(graph) } : {}),
    ...(want("hotspots") ? { hotspots: hotspots(graph) } : {}),
    ...(want("publicApi") ? { publicApi: publicApi(graph) } : {}),
    ...(want("diagnostics") ? { diagnostics: graph.diagnostics.slice(0, 20) } : {}),
    next: resultNext(
      "answer",
      "Counts, layers, hotspots, and public API are sufficient for broad orientation.",
    ),
    guide: resultGuide(
      "Use counts, layers, hotspots, and public API as a broad orientation map. Do not expand it into file reads unless the user needs exact source body text.",
    ),
  };
}

function counts(graph: SamchonGraphMemory): ISamchonGraphOverview.ICounts {
  const byKind: Record<string, number> = {};
  const byLanguage: Record<string, number> = {};
  let files = 0;
  for (const node of graph.nodes) {
    byKind[node.kind] = (byKind[node.kind] ?? 0) + 1;
    byLanguage[node.language] = (byLanguage[node.language] ?? 0) + 1;
    if (node.kind === "file") files++;
  }
  return {
    files,
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    byKind,
    byLanguage,
  };
}

/** Folder-level layering: how source and its export surface spread by directory. */
function layers(graph: SamchonGraphMemory): ISamchonGraphOverview.ILayer[] {
  const byDir = new Map<
    string,
    { files: Set<string>; exported: number; languages: Set<GraphLanguage> }
  >();
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
    if (entry === undefined) {
      entry = { files: new Set(), exported: 0, languages: new Set() };
      byDir.set(dir, entry);
    }
    entry.files.add(node.file);
    entry.languages.add(node.language);
    if (node.exported) entry.exported++;
  }
  return [...byDir.entries()]
    .map(([dir, entry]) => ({
      dir,
      files: entry.files.size,
      exported: entry.exported,
      languages: [...entry.languages],
    }))
    .sort((a, b) => b.files - a.files || b.exported - a.exported)
    .slice(0, 16);
}

/**
 * The symbols at the center of the dependency graph, ranked by real fan-in and
 * fan-out. Structural `contains`/`exports`/`imports` edges are excluded so the
 * ranking reflects code dependency, not nesting.
 */
function hotspots(graph: SamchonGraphMemory): ISamchonGraphOverview.IHotspot[] {
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
      ...summaryOf(node),
      fanIn: real(node.id, "in"),
      fanOut: real(node.id, "out"),
    }))
    .filter((h) => h.fanIn + h.fanOut > 0)
    .sort((a, b) => b.fanIn + b.fanOut - (a.fanIn + a.fanOut))
    .slice(0, 12);
}

/**
 * The exported API surface: the exported symbols a consumer of the project
 * would use, ranked by how depended-on each is (real fan-in/out, structural
 * edges excluded). Ranking by dependency rather than by which file declares the
 * most exports surfaces the load-bearing types instead of whichever file
 * bundles the most aliases; test, typings, and generated files are dropped so
 * they cannot crowd the real surface out.
 */
function publicApi(graph: SamchonGraphMemory): ISamchonGraphOverview.IPublicApi[] {
  const degree = (id: string): number => {
    let n = 0;
    for (const edge of graph.outgoing(id)) if (!isStructural(edge.kind)) n++;
    for (const edge of graph.incoming(id)) if (!isStructural(edge.kind)) n++;
    return n;
  };
  return graph
    .exported()
    .filter(
      (node: ISamchonGraphNode) =>
        API_KINDS.has(node.kind) && !isPublicApiNoisePath(node.file),
    )
    .map((node) => ({ node, degree: degree(node.id) }))
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 16)
    .map((ranked) => summaryOf(ranked.node));
}
