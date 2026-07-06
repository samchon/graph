import { GraphMemory } from "../model/GraphMemory";
import { IGraphOverview } from "../structures";
import { dirname } from "../utils/path";
import {
  isStructural,
  resultGuide,
  resultNext,
  summaryOf,
} from "./common";

export function runOverview(
  graph: GraphMemory,
  props: IGraphOverview.IRequest,
): IGraphOverview {
  const aspect = props.aspect ?? "all";
  return {
    type: "overview",
    project: graph.project,
    languages: graph.languages as IGraphOverview["languages"],
    counts: counts(graph),
    ...(aspect === "all" || aspect === "layers" ? { layers: layers(graph) } : {}),
    ...(aspect === "all" || aspect === "hotspots"
      ? { hotspots: hotspots(graph) }
      : {}),
    ...(aspect === "all" || aspect === "publicApi"
      ? { publicApi: publicApi(graph) }
      : {}),
    ...(aspect === "all" || aspect === "diagnostics"
      ? { diagnostics: graph.diagnostics.slice(0, 20) }
      : {}),
    next: resultNext(
      "answer",
      "The overview contains graph size, language mix, layers, hotspots, public API, and diagnostics.",
    ),
    guide: resultGuide(
      "Use overview facets as architecture evidence. For behavior flow, make one tour or trace request.",
    ),
  };
}

function counts(graph: GraphMemory): IGraphOverview.ICounts {
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

function layers(graph: GraphMemory): IGraphOverview.ILayer[] {
  const map = new Map<string, IGraphOverview.ILayer>();
  for (const node of graph.nodes) {
    if (node.kind !== "file") continue;
    const dir = dirname(node.file);
    let layer = map.get(dir);
    if (layer === undefined) {
      layer = { dir, files: 0, exported: 0, languages: [] };
      map.set(dir, layer);
    }
    layer.files++;
    if (!layer.languages.includes(node.language)) layer.languages.push(node.language);
  }
  for (const node of graph.exported()) {
    const dir = dirname(node.file);
    const layer = map.get(dir);
    if (layer !== undefined) layer.exported++;
  }
  return [...map.values()]
    .sort((a, b) => b.files - a.files || b.exported - a.exported)
    .slice(0, 16);
}

function hotspots(graph: GraphMemory): IGraphOverview.IHotspot[] {
  const out: IGraphOverview.IHotspot[] = [];
  for (const node of graph.nodes) {
    if (node.kind === "file" || node.external) continue;
    const fanIn = graph.incoming(node.id).filter((edge) => !isStructural(edge.kind)).length;
    const fanOut = graph.outgoing(node.id).filter((edge) => !isStructural(edge.kind)).length;
    if (fanIn + fanOut === 0) continue;
    out.push({ ...summaryOf(node), fanIn, fanOut });
  }
  return out
    .sort((a, b) => b.fanIn + b.fanOut - (a.fanIn + a.fanOut))
    .slice(0, 12);
}

function publicApi(graph: GraphMemory): IGraphOverview.IPublicApi[] {
  return graph
    .exported()
    .sort(
      (a, b) =>
        graph.incoming(b.id).filter((edge) => !isStructural(edge.kind)).length -
        graph.incoming(a.id).filter((edge) => !isStructural(edge.kind)).length,
    )
    .slice(0, 16)
    .map(summaryOf);
}
