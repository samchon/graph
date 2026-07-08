import { GraphMemory } from "../model/GraphMemory";
import { IGraphEntrypoints, IGraphNode } from "../structures";
import {
  bound,
  isStructural,
  referencesFromEdges,
  resolveHandle,
  resultGuide,
  resultNext,
  summaryOf,
} from "./common";
import { runLookup } from "./runLookup";

const DEFAULT_LIMIT = 4;
const MAX_LIMIT = 8;

export function runEntrypoints(
  graph: GraphMemory,
  props: IGraphEntrypoints.IRequest,
): IGraphEntrypoints {
  const limit = bound(props.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const lookup = runLookup(graph, {
    type: "lookup",
    query: props.query,
    language: props.language,
    limit,
  });
  const mentions = directMentions(props.query)
    .map((handle) => resolveHandle(graph, handle))
    .flatMap((resolved) =>
      resolved.node === undefined ? [] : [summaryOf(resolved.node)],
    )
    .slice(0, limit);

  const ranked = lookup.hits.map((hit) => ({
    ...hit,
    reason: reasonOf(graph, hit.id),
  }));
  const seeds = ranked
    .map((hit) => graph.node(hit.id))
    .filter((node) => node !== undefined)
    .slice(0, 3);
  const dependencyOrientation = seeds.flatMap((node) =>
    orientationLines(graph, node),
  );

  return {
    type: "entrypoints",
    query: props.query,
    ranked,
    mentions,
    dependencyOrientation,
    next: resultNext(
      "inspect",
      "Use one returned handle for trace/details when the answer needs flow or selected shape.",
      "trace",
    ),
    guide: resultGuide(
      "Use ranked entrypoints, direct mentions, and dependency orientation as the first graph index.",
    ),
  };
}

function directMentions(query: string): string[] {
  const out = new Set<string>();
  for (const match of query.matchAll(/`([^`]+)`/g)) {
    const value = match[1]?.trim();
    if (value !== undefined && value !== "") out.add(value);
  }
  for (const match of query.matchAll(/\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\b/g)) {
    out.add(match[0]);
  }
  return [...out];
}

function reasonOf(graph: GraphMemory, id: string): string {
  const fanIn = graph.incoming(id).filter((edge) => !isStructural(edge.kind)).length;
  const fanOut = graph.outgoing(id).filter((edge) => !isStructural(edge.kind)).length;
  if (fanOut > fanIn) return "High outgoing dependency flow for this query.";
  if (fanIn > 0) return "Referenced by other indexed symbols.";
  return "Name/path match in the resident graph.";
}

function orientationLines(graph: GraphMemory, node: IGraphNode): string[] {
  const dependsOn = referencesFromEdges(graph, graph.outgoing(node.id), "to", 2, false);
  const dependedOnBy = referencesFromEdges(graph, graph.incoming(node.id), "from", 2, false);
  const name = node.qualifiedName ?? node.name;
  const out: string[] = [];
  for (const ref of dependsOn) {
    out.push(`${name} -[${ref.relation}]-> ${ref.name}`);
  }
  for (const ref of dependedOnBy) {
    out.push(`${ref.name} -[${ref.relation}]-> ${name}`);
  }
  return out;
}
