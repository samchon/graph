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
const MAX_SEEDS = 3;
const NEIGHBOR_LIMIT = 2;

/**
 * Build the first source-free entrypoints list for a code question. The result
 * gives the model stable handles, declaration signatures, and direct graph
 * context. It is deliberately not a source reader; details adds selected symbol
 * shape and ranges, not implementation text.
 */
export function runEntrypoints(
  graph: GraphMemory,
  props: IGraphEntrypoints.IRequest,
): IGraphEntrypoints {
  const query = props.query.trim();
  const limit = bound(props.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);

  const lookup = runLookup(graph, {
    type: "lookup",
    query,
    language: props.language,
    limit,
  });
  const ranked = lookup.hits.map((hit) => ({
    ...hit,
    reason: reasonOf(graph, hit.id),
  }));

  // Code handles written directly in the query, resolved to concrete nodes.
  const mentions: IGraphNode[] = [];
  const mentionSeen = new Set<string>();
  for (const handle of directMentions(graph, query)) {
    const resolved = resolveHandle(graph, handle);
    if (resolved.node !== undefined && !mentionSeen.has(resolved.node.id)) {
      mentionSeen.add(resolved.node.id);
      mentions.push(resolved.node);
    }
  }

  // Seeds for dependency orientation: resolved mentions first (the user named
  // them), then the ranked hits.
  const seeds: IGraphNode[] = [];
  const seedSeen = new Set<string>();
  const addSeed = (node: IGraphNode | undefined): void => {
    if (node === undefined || node.kind === "file" || seedSeen.has(node.id)) return;
    seedSeen.add(node.id);
    seeds.push(node);
  };
  for (const node of mentions) addSeed(node);
  for (const hit of ranked) addSeed(graph.node(hit.id));

  const dependencyOrientation = seeds
    .slice(0, MAX_SEEDS)
    .flatMap((node) => orientationLines(graph, node));

  return {
    type: "entrypoints",
    query,
    ranked,
    mentions: mentions.map(summaryOf),
    dependencyOrientation,
    next: resultNext(
      "inspect",
      "Use one returned handle for trace/details when the answer needs flow or selected shape.",
      "trace",
    ),
    guide: resultGuide(
      "Use ranked hits, mentions, and dependency orientation as the code index. If they identify the relevant files and symbols, answer or make one focused trace/details call; do not search the repository to verify them.",
    ),
  };
}

function reasonOf(graph: GraphMemory, id: string): string {
  const fanIn = graph.incoming(id).filter((edge) => !isStructural(edge.kind)).length;
  const fanOut = graph.outgoing(id).filter((edge) => !isStructural(edge.kind)).length;
  if (fanOut > fanIn) return "High outgoing dependency flow for this query.";
  if (fanIn > 0) return "Referenced by other indexed symbols.";
  return "Name/path match in the resident graph.";
}

function orientationLines(graph: GraphMemory, node: IGraphNode): string[] {
  const dependsOn = referencesFromEdges(
    graph,
    graph.outgoing(node.id),
    "to",
    NEIGHBOR_LIMIT,
    false,
  );
  const dependedOnBy = referencesFromEdges(
    graph,
    graph.incoming(node.id),
    "from",
    NEIGHBOR_LIMIT,
    false,
  );
  const name = node.qualifiedName ?? node.name;
  const out: string[] = [];
  for (const ref of dependsOn) out.push(`${name} -[${ref.relation}]-> ${ref.name}`);
  for (const ref of dependedOnBy) out.push(`${ref.name} -[${ref.relation}]-> ${name}`);
  return out;
}

function directMentions(graph: GraphMemory, query: string): string[] {
  const handles = new Set<string>();
  for (const token of query.split(/\s+/)) {
    const handle = normalizeNodeIdToken(token);
    if (handle !== undefined && graph.node(handle) !== undefined) handles.add(handle);
  }
  for (const match of query.matchAll(/`([^`]+)`/g)) {
    const raw = match[1]!;
    const id = normalizeNodeIdToken(raw);
    if (id !== undefined && graph.node(id) !== undefined) {
      handles.add(id);
      continue;
    }
    const handle = normalizeHandle(raw);
    if (handle !== undefined) handles.add(handle);
  }
  for (const match of query.matchAll(
    /\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\b/g,
  )) {
    const handle = normalizeHandle(match[0]);
    if (handle !== undefined) handles.add(handle);
  }
  return [...handles];
}

function normalizeNodeIdToken(raw: string): string | undefined {
  const value = raw
    .trim()
    .replace(/^[`"'([{]+/, "")
    .replace(/[`"',.;:)\]}]+$/, "");
  return /^[^\s#]+#[^\s#]+:[a-z_]+$/.test(value) ? value : undefined;
}

function normalizeHandle(raw: string): string | undefined {
  const value = raw.trim();
  return /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(value) ? value : undefined;
}
