import { SamchonGraphMemory } from "../SamchonGraphMemory";
import {
  ISamchonGraphDecorator,
  ISamchonGraphEdge,
  ISamchonGraphEntrypoints,
  ISamchonGraphNode,
} from "../structures";
import {
  bound,
  isStructural,
  publicEvidence,
  resolveHandle,
  signatureOf,
} from "./common";
import { runLookup } from "./runLookup";

const DEFAULT_LIMIT = 4;
const MAX_LIMIT = 8;
const DEFAULT_NEIGHBORS = 0;
const MAX_NEIGHBORS = 2;
const MAX_SEEDS = 3;

/**
 * Build the first source-free entrypoints list for a code question. The result
 * gives the model stable handles, declaration signatures, and direct graph
 * context. It is deliberately not a source reader; details adds selected symbol
 * shape and ranges, not implementation text.
 */
export function runEntrypoints(
  graph: SamchonGraphMemory,
  props: ISamchonGraphEntrypoints.IRequest,
): ISamchonGraphEntrypoints {
  const query = props.query.trim();
  const limit = bound(props.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const neighborLimit = bound(
    props.neighbors,
    DEFAULT_NEIGHBORS,
    0,
    MAX_NEIGHBORS,
  );

  const lookupResult = runLookup(graph, { type: "lookup", query, limit });
  const hits = lookupResult.hits.map((hit) => ({ ...hit }));

  const mentions = directMentions(graph, query).map((handle) => {
    const resolved = resolveHandle(graph, handle);
    const mention: ISamchonGraphEntrypoints.IMention = { handle };
    if (resolved.node !== undefined)
      mention.node = nodeOf(graph, resolved.node);
    if (resolved.candidates !== undefined) {
      mention.candidates = resolved.candidates.map((node) =>
        nodeOf(graph, node),
      );
    }
    return mention;
  });

  const seeds: ISamchonGraphNode[] = [];
  const seen = new Set<string>();
  const addSeed = (node: ISamchonGraphNode | undefined): void => {
    if (node === undefined || seen.has(node.id)) return;
    seen.add(node.id);
    seeds.push(node);
  };
  for (const mention of mentions) {
    if (mention.node !== undefined) addSeed(graph.node(mention.node.id));
  }
  for (const hit of hits) addSeed(graph.node(hit.id));

  let truncated = seeds.length > MAX_SEEDS;
  const neighborhood: ISamchonGraphEntrypoints.INeighborhood[] = [];
  for (const seed of seeds.slice(0, MAX_SEEDS)) {
    const outgoing = refs(graph, graph.outgoing(seed.id), "to", neighborLimit);
    const incoming = refs(
      graph,
      graph.incoming(seed.id),
      "from",
      neighborLimit,
    );
    if (outgoing.truncated || incoming.truncated) truncated = true;
    neighborhood.push({
      ...nodeOf(graph, seed),
      dependsOn: outgoing.items,
      dependedOnBy: incoming.items,
    });
  }

  return {
    type: "entrypoints",
    query,
    hits,
    mentions,
    neighborhood,
    ...(truncated ? { truncated: true } : {}),
  };
}

function nodeOf(
  graph: SamchonGraphMemory,
  node: ISamchonGraphNode,
): ISamchonGraphEntrypoints.INode {
  const out: ISamchonGraphEntrypoints.INode = {
    id: node.id,
    name: node.qualifiedName ?? node.name,
    kind: node.kind,
    file: node.file,
  };
  if (node.evidence?.startLine !== undefined)
    out.line = node.evidence.startLine;
  const signature = signatureOf(graph.project, node);
  if (signature !== undefined) out.signature = signature;
  const decorators = decoratorsOf(node);
  if (decorators !== undefined) out.decorators = decorators;
  return out;
}

function refOf(
  node: ISamchonGraphNode,
  edge: ISamchonGraphEdge,
): ISamchonGraphEntrypoints.IReference {
  const out: ISamchonGraphEntrypoints.IReference = {
    id: node.id,
    name: node.qualifiedName ?? node.name,
    kind: node.kind,
    file: node.file,
    relation: edge.kind,
  };
  if (node.evidence?.startLine !== undefined)
    out.line = node.evidence.startLine;
  if (edge.evidence !== undefined) out.evidence = publicEvidence(edge.evidence);
  return out;
}

function refs(
  graph: SamchonGraphMemory,
  edges: readonly ISamchonGraphEdge[],
  end: "to" | "from",
  limit: number,
): { items: ISamchonGraphEntrypoints.IReference[]; truncated: boolean } {
  const ranked: Array<{ ref: ISamchonGraphEntrypoints.IReference; rank: number }> =
    [];
  const seen = new Set<string>();
  let available = 0;
  for (const edge of edges) {
    if (isStructural(edge.kind)) continue;
    const other = graph.node(end === "to" ? edge.to : edge.from);
    if (other === undefined || other.kind === "file") continue;
    const key = `${edge.kind}:${other.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    available++;
    const ref = refOf(other, edge);
    ranked.push({ ref, rank: refRank(ref, edge) });
  }
  ranked.sort((a, b) => a.rank - b.rank);
  const items: ISamchonGraphEntrypoints.IReference[] = [];
  for (const item of ranked) {
    if (items.length < limit) items.push(item.ref);
  }
  return { items, truncated: available > items.length };
}

function refRank(
  ref: ISamchonGraphEntrypoints.IReference,
  edge: ISamchonGraphEdge,
): number {
  return (
    edgeKindRank(edge.kind) * 100_000 +
    evidenceRank(edge) +
    (ref.file.startsWith("bundled://") ? 20_000 : 0)
  );
}

function evidenceRank(edge: ISamchonGraphEdge): number {
  const line = edge.evidence?.startLine ?? 9_999;
  const col = edge.evidence?.startCol ?? 999;
  return line * 100 + col;
}

function edgeKindRank(kind: string): number {
  switch (kind) {
    case "calls":
      return 0;
    case "instantiates":
      return 1;
    case "accesses":
    case "renders":
      return 2;
    case "tests":
      return 3;
    case "overrides":
    case "decorates":
      return 4;
    case "extends":
    case "implements":
      return 5;
    case "type_ref":
      return 6;
    default:
      return 10;
  }
}

function directMentions(graph: SamchonGraphMemory, query: string): string[] {
  const handles = new Set<string>();
  for (const token of query.split(/\s+/)) {
    const handle = normalizeNodeIdToken(token);
    if (handle !== undefined && graph.node(handle) !== undefined) {
      handles.add(handle);
    }
  }
  for (const match of query.matchAll(/`([^`]+)`/g)) {
    // The capture group is required (`+`), so a match always has it.
    /* c8 ignore next */
    const raw = match[1] ?? "";
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
  return /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(value)
    ? value
    : undefined;
}

/** Decorator facts already captured on a node, omitted when absent. */
function decoratorsOf(
  node: ISamchonGraphNode,
): ISamchonGraphDecorator[] | undefined {
  return node.decorators !== undefined && node.decorators.length > 0
    ? node.decorators
    : undefined;
}
