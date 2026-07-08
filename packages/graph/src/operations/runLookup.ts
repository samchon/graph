import { GraphMemory } from "../model/GraphMemory";
import { IGraphLookup, IGraphNode } from "../structures";
import { isSupportPath } from "./isSupportPath";
import {
  bound,
  isStructural,
  isTestPath,
  resultGuide,
  resultNext,
  signatureOf,
  subwords,
  summaryOf,
} from "./common";

// One file should not crowd out the rest of the ranking, so cap hits per file.
const PER_FILE = 3;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 6;

/**
 * Rank the graph's symbols against a natural query. Scoring blends exact and
 * dotted-name matches, CamelCase/subword coverage, file-path terms, a prefix
 * bonus, and dependency centrality, then dampens external, generated, and test
 * nodes and caps per file so the result is a diverse, relevant shortlist rather
 * than one file's roster.
 */
export function runLookup(
  graph: GraphMemory,
  props: IGraphLookup.IRequest,
): IGraphLookup {
  const terms = subwords(props.query);
  const codeTerms = exactCodeTerms(props.query);
  const requestedKinds = requestedSymbolKinds(props.query);
  const queryLc = props.query.trim().toLowerCase();
  const wantsInternal = wantsInternalSymbol(queryLc, codeTerms);
  const wantsSupport = wantsSupportSymbol(queryLc);
  const includeExternal = props.includeExternal === true;
  if (terms.length === 0) {
    return {
      type: "lookup",
      hits: [],
      next: resultNext(
        "clarify",
        "No symbol matched; ask for a concrete symbol or scope.",
      ),
      guide: resultGuide(
        "No symbol matched; answer that the graph did not resolve this name or ask for a more concrete symbol.",
      ),
    };
  }

  const scored: IGraphLookup.IHit[] = [];
  for (const node of graph.nodes) {
    if (node.kind === "file") continue;
    if (!includeExternal && node.external) continue;
    if (props.language !== undefined && node.language !== props.language) continue;
    if (props.kind !== undefined && node.kind !== props.kind) continue;
    const score = scoreNode(
      graph,
      node,
      queryLc,
      terms,
      codeTerms,
      requestedKinds,
      wantsInternal,
      wantsSupport,
    );
    if (score <= 0) continue;
    const hit: IGraphLookup.IHit = {
      ...summaryOf(node),
      score: Math.round(score),
    };
    if (node.decorators !== undefined && node.decorators.length > 0) {
      hit.decorators = node.decorators;
    }
    scored.push(hit);
  }

  scored.sort((a, b) => b.score - a.score);

  // Diversity: keep at most PER_FILE hits per file while filling up to the limit.
  const limit = bound(props.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const perFile = new Map<string, number>();
  const hits: IGraphLookup.IHit[] = [];
  for (const hit of scored) {
    const used = perFile.get(hit.file) ?? 0;
    if (used >= PER_FILE) continue;
    perFile.set(hit.file, used + 1);
    hits.push(hit);
    if (hits.length >= limit) break;
  }

  // Attach each kept hit's signature only for the shortlist, so the model can
  // often answer from lookup alone without a details call.
  for (const hit of hits) {
    const node = graph.node(hit.id);
    // hits are built from real graph nodes, so the id always resolves.
    /* c8 ignore next */
    if (node === undefined) continue;
    const sig = signatureOf(graph.project, node);
    if (sig !== undefined) hit.signature = sig;
  }

  // Backtick-quoted code handles that matched nothing are worth flagging so the
  // model does not silently assume they resolved.
  const matched = new Set(
    hits.flatMap((hit) => subwords(hit.name)),
  );
  const unknown = codeTerms.filter(
    (term) => !subwords(term).every((sub) => matched.has(sub)),
  );

  return {
    type: "lookup",
    hits,
    ...(unknown.length > 0 ? { unknown } : {}),
    next: resultNext(
      "inspect",
      "Use one returned id for trace/details when the answer needs flow or shape.",
      "details",
    ),
    guide: resultGuide(
      "Use ranked hits and signatures as symbol evidence. If the target is clear, answer or make one focused trace/details call; do not search files to verify the match.",
    ),
  };
}

/** Score one node against the query; 0 means no match. */
function scoreNode(
  graph: GraphMemory,
  node: IGraphNode,
  queryLc: string,
  terms: readonly string[],
  codeTerms: readonly string[],
  requestedKinds: Set<string>,
  wantsInternal: boolean,
  wantsSupport: boolean,
): number {
  const name = node.name.toLowerCase();
  const qualified = (node.qualifiedName ?? node.name).toLowerCase();
  const nameSubs = subwords(node.name);
  const qualifiedSubs = subwords(node.qualifiedName ?? node.name);
  const pathSubs = subwords(node.file);

  let score = 0;
  if (queryLc === name || queryLc === qualified) {
    score += 100;
  } else if (qualified.includes(".") && queryLc.includes(qualified)) {
    score += 85;
  } else if (queryLc.includes(".") && qualified.includes(queryLc)) {
    score += 60;
  }

  for (const codeTerm of codeTerms) {
    if (name === codeTerm || qualified === codeTerm) {
      score += 110;
    } else if (qualified.endsWith(`.${codeTerm}`)) {
      score += 95;
    } else if (codeTerm.includes(".") && qualified.endsWith(codeTerm)) {
      score += 85;
    }
  }

  if (requestedKinds.has(node.kind)) score += 16;

  let covered = 0;
  for (const term of terms) {
    if (nameSubs.includes(term)) {
      score += 12;
      covered++;
    } else if (qualifiedSubs.includes(term)) {
      score += 8;
      covered++;
    } else if (name.includes(term)) {
      score += 5;
      covered++;
    } else if (pathSubs.includes(term)) {
      score += 3;
    }
  }
  // Every query term landed somewhere in the name: a strong whole-query match.
  if (covered === terms.length) score += 10;
  if (name.startsWith(terms[0]!)) score += 4;

  if (score <= 0) return 0;

  // Centrality: a symbol the codebase leans on is a likelier target.
  const fan = degree(graph, node.id);
  score += Math.min(8, Math.log2(1 + fan) * 2);

  // Dampen what is rarely the intended target.
  if (node.ignored) score *= 0.3;
  if (isTestPath(node.file)) score *= 0.7;
  if (!wantsSupport && isSupportPath(node.file)) score *= 0.35;
  if (!wantsInternal && isInternalish(node)) score *= 0.82;
  return score;
}

function wantsSupportSymbol(queryLc: string): boolean {
  return /\b(test|tests|spec|fixture|fixtures|sample|samples|example|examples|generated|build|dist)\b/.test(
    queryLc,
  );
}

function wantsInternalSymbol(queryLc: string, codeTerms: readonly string[]): boolean {
  return (
    /\b(internal|private|implementation|impl)\b/.test(queryLc) ||
    codeTerms.some((term) => term.startsWith("_") || term.includes("internal"))
  );
}

function isInternalish(node: IGraphNode): boolean {
  const name = node.qualifiedName ?? node.name;
  return (
    name.startsWith("_") ||
    name.includes("._") ||
    subwords(name).some((word) => word === "internal" || word === "internals")
  );
}

function exactCodeTerms(query: string): string[] {
  const out = new Set<string>();
  for (const match of query.matchAll(/`([^`]+)`/g)) {
    const normalized = normalizeCodeTerm(match[1]!);
    if (normalized !== undefined) out.add(normalized);
  }
  for (const match of query.matchAll(
    /\b([A-Za-z_$][\w$]*)\s+(method|function|class|interface|type|variable)\b/gi,
  )) {
    const normalized = normalizeCodeTerm(match[1]!);
    if (normalized !== undefined) out.add(normalized);
  }
  for (const match of query.matchAll(
    /\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\b/g,
  )) {
    const normalized = normalizeCodeTerm(match[0]);
    if (normalized !== undefined) out.add(normalized);
  }
  return [...out];
}

function requestedSymbolKinds(query: string): Set<string> {
  const kinds = new Set<string>();
  const lc = query.toLowerCase();
  if (/\bmethods?\b/.test(lc)) kinds.add("method");
  if (/\bfunctions?\b/.test(lc)) {
    kinds.add("function");
    kinds.add("method");
    kinds.add("variable");
  }
  if (/\bclasses?\b/.test(lc)) kinds.add("class");
  if (/\binterfaces?\b/.test(lc)) kinds.add("interface");
  if (/\btypes?\b/.test(lc)) kinds.add("type");
  if (/\bvariables?\b|\bconst\b|\blet\b/.test(lc)) kinds.add("variable");
  return kinds;
}

function normalizeCodeTerm(raw: string): string | undefined {
  const value = raw.trim().toLowerCase();
  return /^[a-z_$][\w$]*(?:\.[a-z_$][\w$]*)*$/.test(value) ? value : undefined;
}

/** Non-structural in+out degree (code dependency, not nesting). */
function degree(graph: GraphMemory, id: string): number {
  let n = 0;
  for (const edge of graph.outgoing(id)) if (!isStructural(edge.kind)) n++;
  for (const edge of graph.incoming(id)) if (!isStructural(edge.kind)) n++;
  return n;
}
