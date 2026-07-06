import { GraphMemory } from "../model/GraphMemory";
import { IGraphLookup, IGraphNode } from "../structures";
import {
  bound,
  isStructural,
  resultGuide,
  resultNext,
  signatureOf,
  subwords,
  summaryOf,
} from "./common";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 8;

export function runLookup(
  graph: GraphMemory,
  props: IGraphLookup.IRequest,
): IGraphLookup {
  const query = props.query.trim();
  const terms = subwords(query);
  if (terms.length === 0) {
    return {
      type: "lookup",
      hits: [],
      next: resultNext("clarify", "The lookup query is empty."),
      guide: resultGuide("Ask for a concrete symbol, file, or phrase."),
    };
  }

  const includeExternal = props.includeExternal === true;
  const scored: IGraphLookup.IHit[] = [];
  for (const node of graph.nodes) {
    if (node.kind === "file") continue;
    if (!includeExternal && node.external) continue;
    if (props.language !== undefined && node.language !== props.language) continue;
    if (props.kind !== undefined && node.kind !== props.kind) continue;
    const score = scoreNode(graph, node, query, terms);
    if (score <= 0) continue;
    const hit: IGraphLookup.IHit = {
      ...summaryOf(node),
      score: Math.round(score),
    };
    const signature = signatureOf(graph.project, node);
    if (signature !== undefined) hit.signature = signature;
    if (node.decorators !== undefined && node.decorators.length > 0) {
      hit.decorators = node.decorators;
    }
    scored.push(hit);
  }

  scored.sort((a, b) => b.score - a.score);
  const limit = bound(props.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  return {
    type: "lookup",
    hits: diversify(scored, limit),
    next: resultNext(
      "inspect",
      "Use one returned id for details or trace when the answer needs selected shape or flow.",
      "details",
    ),
    guide: resultGuide(
      "Use ranked hits and signatures as symbol evidence. If the target is clear, answer or make one focused details/trace call.",
    ),
  };
}

function scoreNode(
  graph: GraphMemory,
  node: IGraphNode,
  query: string,
  terms: readonly string[],
): number {
  const name = node.name.toLowerCase();
  const qualified = (node.qualifiedName ?? node.name).toLowerCase();
  const file = node.file.toLowerCase();
  const queryLc = query.toLowerCase();
  let score = 0;

  if (queryLc === name || queryLc === qualified || queryLc === node.id.toLowerCase()) {
    score += 120;
  } else if (qualified.endsWith(queryLc) || queryLc.includes(qualified)) {
    score += 85;
  } else if (file.endsWith(queryLc)) {
    score += 55;
  }

  const nameWords = subwords(node.qualifiedName ?? node.name);
  const fileWords = subwords(node.file);
  let covered = 0;
  for (const term of terms) {
    if (nameWords.includes(term)) {
      score += 14;
      covered++;
    } else if (name.includes(term) || qualified.includes(term)) {
      score += 8;
      covered++;
    } else if (fileWords.includes(term) || file.includes(term)) {
      score += 3;
    }
  }
  if (covered === terms.length) score += 12;
  if (node.exported) score += 8;
  if (node.decorators !== undefined && node.decorators.length > 0) score += 4;
  const degree =
    graph.incoming(node.id).filter((edge) => !isStructural(edge.kind)).length +
    graph.outgoing(node.id).filter((edge) => !isStructural(edge.kind)).length;
  score += Math.min(10, Math.log2(1 + degree) * 2);
  if (node.ignored) score *= 0.3;
  return score;
}

function diversify(hits: IGraphLookup.IHit[], limit: number): IGraphLookup.IHit[] {
  const out: IGraphLookup.IHit[] = [];
  const perFile = new Map<string, number>();
  for (const hit of hits) {
    const used = perFile.get(hit.file) ?? 0;
    if (used >= 3) continue;
    perFile.set(hit.file, used + 1);
    out.push(hit);
    if (out.length >= limit) break;
  }
  return out;
}
