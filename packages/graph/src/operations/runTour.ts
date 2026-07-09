import { SamchonGraphMemory } from "../SamchonGraphMemory";
import {
  ISamchonGraphDetails,
  ISamchonGraphEntrypoints,
  ISamchonGraphEvidence,
  ISamchonGraphNode,
  ISamchonGraphTour,
  ISamchonGraphTrace,
} from "../structures";
import { bound, isTestPath, resultGuide, resultNext } from "./common";
import { runDetails } from "./runDetails";
import { runEntrypoints } from "./runEntrypoints";
import { runTrace } from "./runTrace";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 5;
const FLOW_SEEDS = 5;
const DETAIL_SEEDS = 3;
const TEST_SEEDS = 3;
const MAX_FLOW_ANCHORS = 8;
const MAX_NEARBY = 10;
const MAX_TESTS = 8;
const MAX_READ_NEXT = 14;
const TOUR_TRACE_MAX_DEPTH = 3;
const TOUR_TRACE_MAX_NODES = 16;
const STRUCTURAL_KINDS = new Set<string>(["contains", "exports", "imports"]);
const EXECUTION_KINDS = new Set<string>([
  "calls",
  "instantiates",
  "accesses",
  "renders",
  "references",
]);
const TOUR_SEED_KINDS = new Set<string>([
  "class",
  "function",
  "method",
  "property",
  "variable",
  "module",
  "namespace",
  "enum",
]);
const QUERY_STOP_WORDS = new Set<string>([
  "about",
  "after",
  "and",
  "are",
  "api",
  "architecture",
  "around",
  "before",
  "based",
  "behavior",
  "between",
  "but",
  "can",
  "central",
  "change",
  "changes",
  "code",
  "does",
  "for",
  "first",
  "find",
  "flow",
  "from",
  "has",
  "have",
  "how",
  "include",
  "including",
  "implementation",
  "into",
  "its",
  "nearby",
  "need",
  "needs",
  "new",
  "next",
  "path",
  "paths",
  "project",
  "public",
  "read",
  "real",
  "runtime",
  "should",
  "show",
  "that",
  "the",
  "this",
  "test",
  "tests",
  "trace",
  "through",
  "with",
  "without",
  "tour",
  "typescript",
  "user",
  "what",
  "where",
  "which",
  "work",
]);

/**
 * Compose a repository-orientation/code-tour answer surface from existing graph
 * operations. It returns selected symbols, flows, nearby edges, test anchors,
 * and answer anchors without reading or embedding source bodies.
 */
export function runTour(graph: SamchonGraphMemory, props: ISamchonGraphTour.IRequest): ISamchonGraphTour {
  const query = props.query.trim();
  const limit = bound(props.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const entry = runEntrypoints(graph, {
    type: "entrypoints",
    query,
    language: props.language,
    limit,
  });
  const terms = queryTerms(graph, query);
  const seeds = tourSeedsOf(graph, entry, query, terms, limit);
  const seedIds = seeds.map((node) => node.id);
  const flowSeedIds = flowSeedIdsOf(seeds);

  const entrypoints: ISamchonGraphTour.INode[] = seeds.map((node) => graphNodeOf(node));

  const primaryFlow: ISamchonGraphTour.IFlow[] = [];
  for (const id of flowSeedIds.slice(0, FLOW_SEEDS)) {
    const trace = runTrace(graph, {
      type: "trace",
      from: id,
      direction: "forward",
      focus: "execution",
      maxDepth: TOUR_TRACE_MAX_DEPTH,
      maxNodes: TOUR_TRACE_MAX_NODES,
    });
    const start = trace.start;
    if (start === undefined) continue;
    const reached = trace.reached.filter((node) => !isNoisePath(node.file));
    primaryFlow.push({
      start: traceNodeOf(start),
      // trace.steps always mirrors trace.hops for a forward trace; the `?? []`
      // is a type-level guard.
      /* c8 ignore next */
      steps: (trace.steps ?? []).slice(0, MAX_FLOW_ANCHORS),
      reached: reached.map(traceNodeOf),
      anchors: flowAnchorsOf(graph, trace, reached).slice(0, MAX_FLOW_ANCHORS),
      ...(trace.truncated ? { truncated: true } : {}),
    });
  }

  const details =
    seedIds.length === 0
      ? undefined
      : runDetails(graph, {
          type: "details",
          handles: seedIds.slice(0, DETAIL_SEEDS),
          neighbors: true,
          memberLimit: 4,
          dependencyLimit: 2,
          neighborLimit: 2,
        });
  const nearby = details === undefined ? [] : nearbyAnchorsOf(details);

  const tests =
    props.includeTests === false
      ? []
      : testAnchorsOf(
          graph,
          uniqueIds([
            ...seedIds.slice(0, TEST_SEEDS),
            ...primaryFlow.flatMap((flow) => flow.reached.map((node) => node.id)),
          ]),
        );

  const answerAnchors = uniqueAnchors([
    ...entrypoints.flatMap((node) => anchorFromNode("central entrypoint", node)),
    ...primaryFlow.flatMap((flow) => flow.anchors),
    ...nearby,
    ...tests,
  ]).slice(0, MAX_READ_NEXT);

  return {
    type: "tour",
    query,
    entrypoints,
    primaryFlow,
    nearby: nearby.slice(0, MAX_NEARBY),
    tests: tests.slice(0, MAX_TESTS),
    answerAnchors,
    diagnostics: graph.diagnostics.slice(0, 12),
    next: resultNext(
      "answer",
      "This tour is the complete index-level answer surface: central entrypoints, primary flow, nearby paths, tests, and answer anchors.",
    ),
    guide: resultGuide(
      "Use this tour as the answer-ready index. Do not split it into extra lookup/details/trace calls unless the user asks for a named missing symbol or exact source text.",
    ),
    ...(primaryFlow.some((flow) => flow.truncated === true) || nearby.length > MAX_NEARBY || tests.length > MAX_TESTS
      ? { truncated: true }
      : {}),
  };
}

// Rank and select the central symbols the tour is built around: named
// mentions and explicit handles from the query first, then query-scored
// high-degree seeds, falling back to the raw ranked hits.
function tourSeedsOf(
  graph: SamchonGraphMemory,
  entry: ISamchonGraphEntrypoints,
  query: string,
  terms: string[],
  limit: number,
): ISamchonGraphNode[] {
  const out: ISamchonGraphNode[] = [];
  const seen = new Set<string>();
  const add = (node: ISamchonGraphNode | undefined): void => {
    if (node === undefined || seen.has(node.id) || !isTourSeed(graph, node)) return;
    seen.add(node.id);
    out.push(node);
  };
  for (const mention of entry.mentions) add(graph.node(mention.id));
  if (hasExplicitSymbolHandle(query)) {
    for (const hit of entry.ranked) add(graph.node(hit.id));
  }
  for (const node of rankedTourSeeds(graph, terms)) add(node);
  if (out.length === 0) {
    for (const hit of entry.ranked) add(graph.node(hit.id));
  }
  return out.slice(0, limit);
}

// --- result packaging (ported verbatim from the reference engine) ---------

function graphNodeOf(node: ISamchonGraphNode): ISamchonGraphTour.INode {
  const span = node.implementation ?? node.evidence;
  return {
    id: node.id,
    name: node.qualifiedName ?? node.name,
    kind: node.kind,
    file: node.file,
    ...(node.evidence?.startLine !== undefined ? { line: node.evidence.startLine } : {}),
    ...(span !== undefined
      ? {
          sourceSpan: {
            file: span.file,
            startLine: span.startLine,
            ...(span.endLine !== undefined ? { endLine: span.endLine } : {}),
          },
        }
      : {}),
    ...(node.signature !== undefined ? { signature: node.signature } : {}),
    ...(node.decorators !== undefined ? { decorators: node.decorators } : {}),
  };
}

function traceNodeOf(node: ISamchonGraphTrace.INode): ISamchonGraphTour.INode {
  return {
    id: node.id,
    name: node.name,
    kind: node.kind,
    file: node.file,
    ...(node.line !== undefined ? { line: node.line } : {}),
    ...(node.sourceSpan !== undefined
      ? {
          sourceSpan: {
            file: node.sourceSpan.file,
            startLine: node.sourceSpan.startLine,
            ...(node.sourceSpan.endLine !== undefined ? { endLine: node.sourceSpan.endLine } : {}),
          },
        }
      : {}),
    ...(node.signature !== undefined ? { signature: node.signature } : {}),
  };
}

function detailNodeOf(node: ISamchonGraphDetails.INode): ISamchonGraphTour.INode {
  return {
    id: node.id,
    name: node.name,
    kind: node.kind,
    file: node.file,
    ...(node.line !== undefined ? { line: node.line } : {}),
    ...(node.sourceSpan !== undefined
      ? {
          sourceSpan: {
            file: node.sourceSpan.file,
            startLine: node.sourceSpan.startLine,
            ...(node.sourceSpan.endLine !== undefined ? { endLine: node.sourceSpan.endLine } : {}),
          },
        }
      : {}),
    ...(node.signature !== undefined ? { signature: node.signature } : {}),
    ...(node.decorators !== undefined ? { decorators: node.decorators } : {}),
  };
}

function anchorFromNode(
  reason: string,
  node: ISamchonGraphTour.INode | undefined,
): ISamchonGraphTour.IAnchor[] {
  if (node === undefined) return [];
  const span = node.sourceSpan ?? (node.line !== undefined ? { file: node.file, startLine: node.line } : undefined);
  if (span === undefined) return [];
  return [
    {
      reason,
      id: node.id,
      name: node.name,
      kind: node.kind,
      file: span.file,
      startLine: span.startLine,
      ...(span.endLine !== undefined ? { endLine: span.endLine } : {}),
    },
  ];
}

function anchorFromEvidence(
  reason: string,
  name: string,
  evidence: ISamchonGraphEvidence | undefined,
): ISamchonGraphTour.IAnchor[] {
  if (evidence === undefined) return [];
  return [
    {
      reason,
      name,
      file: evidence.file,
      startLine: evidence.startLine,
      ...(evidence.endLine !== undefined ? { endLine: evidence.endLine } : {}),
    },
  ];
}

function flowAnchorsOf(
  graph: SamchonGraphMemory,
  trace: ISamchonGraphTrace,
  reached: ISamchonGraphTrace.INode[],
): ISamchonGraphTour.IAnchor[] {
  const hops = trace.hops.filter((hop) => isTourHop(graph, hop));
  return uniqueAnchors([
    ...anchorFromNode("flow start", trace.start === undefined ? undefined : traceNodeOf(trace.start)),
    ...reached.flatMap((node) => anchorFromNode("flow node", traceNodeOf(node))),
    ...hops.flatMap((hop) => anchorFromEvidence("flow edge", `${hop.from} -> ${hop.to}`, hop.evidence)),
  ]);
}

// Collect nearby dependency anchors from the selected seeds' resolved
// details: the seed itself, plus every direct call/type/dependency edge,
// each tagged with the edge relation as its reason.
function nearbyAnchorsOf(details: ISamchonGraphDetails): ISamchonGraphTour.IAnchor[] {
  const anchors: ISamchonGraphTour.IAnchor[] = [];
  for (const node of details.nodes) {
    anchors.push(...anchorFromNode("selected symbol", detailNodeOf(node)));
    const refs = [node.calls, node.types, node.dependsOn, node.dependedOnBy].flatMap((group) => group ?? []);
    for (const ref of refs) {
      anchors.push(...anchorFromEvidence(`${ref.relation} ${ref.name}`, ref.name, ref.evidence));
    }
  }
  return uniqueAnchors(anchors);
}

// Collect test/usage anchors: test-file callers pointing at the seeds, plus
// test-role nodes reached through the impact edges.
function testAnchorsOf(graph: SamchonGraphMemory, seedIds: string[]): ISamchonGraphTour.IAnchor[] {
  const anchors: ISamchonGraphTour.IAnchor[] = [];
  for (const id of seedIds) {
    for (const edge of graph.incoming(id)) {
      const node = graph.node(edge.from);
      if (node === undefined || !isTestPath(node.file)) continue;
      anchors.push(...anchorFromNode("test coverage", graphNodeOf(node)));
      anchors.push(
        ...anchorFromEvidence(
          `${edge.kind} ${node.qualifiedName ?? node.name}`,
          node.qualifiedName ?? node.name,
          edge.evidence,
        ),
      );
    }
    const impact = runTrace(graph, {
      type: "trace",
      from: id,
      direction: "impact",
      maxDepth: 4,
      maxNodes: 16,
    });
    for (const node of impact.reached) {
      if (node.roles?.includes("test") === true) {
        anchors.push(...anchorFromNode("test coverage", traceNodeOf(node)));
      }
    }
  }
  return uniqueAnchors(anchors);
}

function uniqueAnchors(anchors: ISamchonGraphTour.IAnchor[]): ISamchonGraphTour.IAnchor[] {
  const out: ISamchonGraphTour.IAnchor[] = [];
  const seen = new Set<string>();
  for (const anchor of anchors) {
    const key = `${anchor.file}:${anchor.startLine}:${anchor.name}:${anchor.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(anchor);
  }
  return out;
}

// --- query relevance scoring (ported from the reference engine) -------------

function queryTerms(graph: SamchonGraphMemory, query: string): string[] {
  const projectTerms = new Set(subwords(graph.project));
  return subwords(query).filter(
    (term) => term.length > 2 && !QUERY_STOP_WORDS.has(term) && !projectTerms.has(term),
  );
}

function rankedTourSeeds(graph: SamchonGraphMemory, terms: string[]): ISamchonGraphNode[] {
  const items = graph.nodes
    .filter((node) => isTourSeed(graph, node))
    .map((node) => ({
      node,
      score: tourSeedScore(graph, node, terms),
      matchedTerms: matchedQueryTerms(node, terms),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  return diverseTourSeeds(items, terms).map((item) => item.node);
}

function tourSeedScore(graph: SamchonGraphMemory, node: ISamchonGraphNode, terms: string[]): number {
  const degree = realDegree(graph, node.id);
  const execution = executionDegree(graph, node.id);
  const queryWords = new Set(terms);
  const matchScore = queryMatchScore(node, terms);
  let score = kindScore(node.kind);
  const surface = entrySurfaceScore(node);
  score += surface;
  score += runtimeEntryScore(node, surface);
  score += Math.min(14, Math.log2(1 + degree.in) * 4);
  score += Math.min(30, Math.log2(1 + degree.out) * 9);
  score += Math.min(28, Math.log2(1 + execution.out) * 10);
  if (node.exported === true) score += 14;
  if (node.decorators !== undefined && node.decorators.length > 0) score += 10;
  score += matchScore;
  score *= queryAlignmentFactor(matchScore, queryWords);
  score *= broadTourDamping(node, queryWords);
  return score;
}

function isTourSeed(graph: SamchonGraphMemory, node: ISamchonGraphNode): boolean {
  return (
    TOUR_SEED_KINDS.has(node.kind) &&
    (node.kind !== "property" || executionDegree(graph, node.id).out > 0) &&
    !node.external &&
    node.ignored !== true &&
    node.evidence !== undefined &&
    !isNoisePath(node.file)
  );
}

function flowSeedIdsOf(seeds: ISamchonGraphNode[]): string[] {
  const executable = seeds.filter((node) =>
    ["function", "method", "property", "variable"].includes(node.kind),
  );
  const source = executable.length === 0 ? seeds : executable;
  return source.map((node) => node.id);
}

function isTourHop(graph: SamchonGraphMemory, hop: ISamchonGraphTrace.IHop): boolean {
  const from = graph.node(hop.from);
  const to = graph.node(hop.to);
  return (
    from !== undefined &&
    to !== undefined &&
    !STRUCTURAL_KINDS.has(hop.kind) &&
    !isNoisePath(from.file) &&
    !isNoisePath(to.file)
  );
}

function realDegree(graph: SamchonGraphMemory, id: string): { in: number; out: number } {
  let incoming = 0;
  let outgoing = 0;
  for (const edge of graph.outgoing(id)) if (!STRUCTURAL_KINDS.has(edge.kind)) outgoing++;
  for (const edge of graph.incoming(id)) if (!STRUCTURAL_KINDS.has(edge.kind)) incoming++;
  return { in: incoming, out: outgoing };
}

function executionDegree(graph: SamchonGraphMemory, id: string): { in: number; out: number } {
  let incoming = 0;
  let outgoing = 0;
  for (const edge of graph.outgoing(id)) if (EXECUTION_KINDS.has(edge.kind)) outgoing++;
  for (const edge of graph.incoming(id)) if (EXECUTION_KINDS.has(edge.kind)) incoming++;
  return { in: incoming, out: outgoing };
}

function kindScore(kind: string): number {
  switch (kind) {
    case "function":
    case "method":
      return 28;
    case "property":
    case "variable":
      return 8;
    case "class":
      return 24;
    case "module":
    case "namespace":
      return 16;
    case "enum":
      return 10;
    // every TOUR_SEED_KIND has an explicit case above; the default is a
    // defensive fallback unreachable from the seed filter.
    /* c8 ignore next 2 */
    default:
      return 0;
  }
}

function entrySurfaceScore(node: ISamchonGraphNode): number {
  const file = node.file.replace(/\\/g, "/");
  const base = file.slice(file.lastIndexOf("/") + 1).toLowerCase();
  const stem = base.replace(/\.[cm]?[tj]sx?$/, "");
  const depth = sourceDepth(file);
  let score = 0;
  if (stem === "index") {
    if (depth <= 0) score += 48;
    else if (depth === 1) score += 32;
    else if (depth === 2) score += 12;
  } else if (stem === "main" || stem === "server" || stem === "bootstrap") score += 42;
  else if (stem === "app" || stem === "application") score += 28;

  if (depth <= 1) score += 22;
  else if (depth === 2) score += 12;
  else if (depth === 3) score += 5;

  if (node.exported === true && score > 0) score += 12;
  return score;
}

function runtimeEntryScore(node: ISamchonGraphNode, surface: number): number {
  const words = new Set([
    ...subwords(node.name),
    ...subwords(node.qualifiedName ?? ""),
  ]);
  if (isPrivateLike(node, words)) return 0;
  const hasVerb = hasAny(words, [
    "bootstrap",
    "create",
    "execute",
    "handle",
    "init",
    "initialize",
    "listen",
    "mount",
    "open",
    "parse",
    "render",
    "run",
    "safe",
    "safeparse",
    "start",
    "startup",
    "subscribe",
    "update",
  ]);
  if (node.kind === "method" && hasVerb) return 90;
  if (
    (node.kind === "function" || node.kind === "property" || node.kind === "variable") &&
    surface > 0 &&
    hasVerb
  ) {
    return 70;
  }
  if (
    node.kind === "class" &&
    hasAny(words, [
      "application",
      "app",
      "backend",
      "client",
      "datasource",
      "factory",
      "server",
    ])
  ) {
    return 45;
  }
  return 0;
}

function sourceDepth(file: string): number {
  const parts = file.split("/").filter(Boolean);
  if (parts[0] === "src") return Math.max(0, parts.length - 2);
  if (parts[0] === "packages" && parts.length >= 3) return Math.max(
    0,
    parts.length - 3,
  );
  return Math.max(0, parts.length - 1);
}

function queryMatchScore(node: ISamchonGraphNode, terms: string[]): number {
  return matchedQueryTerms(node, terms).size * 8 + matchedFileTerms(node, terms).size * 2;
}

function matchedQueryTerms(node: ISamchonGraphNode, terms: string[]): Set<string> {
  const words = [...subwords(node.name), ...subwords(node.qualifiedName ?? "")];
  return matchedTerms(words, terms);
}

function matchedFileTerms(node: ISamchonGraphNode, terms: string[]): Set<string> {
  return matchedTerms(subwords(node.file), terms);
}

function matchedTerms(words: string[], terms: string[]): Set<string> {
  const wordSet = new Set(words);
  const stems = new Set(words.map(stemWord));
  const matched = new Set<string>();
  for (const term of terms) {
    if (
      wordSet.has(term) ||
      stems.has(stemWord(term)) ||
      words.some(
        (word) => commonPrefixLength(stemWord(term), stemWord(word)) >= 6,
      )
    ) {
      matched.add(term);
    }
  }
  return matched;
}

function diverseTourSeeds<T extends { score: number; matchedTerms: Set<string> }>(
  items: T[],
  terms: string[],
): T[] {
  if (items.length <= 1 || terms.length === 0) return items;
  const out: T[] = [];
  const remaining = [...items];
  const uncovered = new Set(terms);
  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < remaining.length; i++) {
      const item = remaining[i]!;
      let coverage = 0;
      for (const term of item.matchedTerms) if (uncovered.has(term)) coverage++;
      const score = coverage * 120 + item.score;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    const [picked] = remaining.splice(bestIndex, 1);
    out.push(picked!);
    for (const term of picked!.matchedTerms) uncovered.delete(term);
  }
  return out;
}

function queryAlignmentFactor(matchScore: number, queryWords: ReadonlySet<string>): number {
  if (queryWords.size === 0) return 1;
  if (matchScore >= 24) return 1.45;
  if (matchScore >= 8) return 1.15;
  return 0.45;
}

function broadTourDamping(node: ISamchonGraphNode, queryWords: ReadonlySet<string>): number {
  const words = new Set([
    ...subwords(node.name),
    ...subwords(node.qualifiedName ?? ""),
    ...subwords(node.file),
  ]);
  let factor = 1;
  if (!hasAny(queryWords, ["internal", "private"]) && isPrivateLike(node, words)) {
    factor *= 0.25;
  }
  if (
    !hasAny(queryWords, ["error", "errors", "exception", "exceptions"]) &&
    hasAny(words, ["error", "errors", "exception", "exceptions"])
  ) {
    factor *= 0.25;
  }
  if (
    !hasAny(queryWords, [
      "config",
      "configuration",
      "env",
      "environment",
      "option",
      "options",
      "port",
    ]) &&
    (node.kind === "variable" || node.kind === "property") &&
    hasAny(words, [
      "config",
      "configuration",
      "env",
      "environment",
      "option",
      "options",
      "port",
    ])
  ) {
    factor *= 0.35;
  }
  if (
    !hasAny(queryWords, [
      "deserialize",
      "deserializer",
      "serializer",
      "serialize",
      "serialization",
    ]) &&
    hasAny(words, [
      "deserialize",
      "deserializer",
      "serializer",
      "serialize",
      "serialization",
    ])
  ) {
    factor *= 0.25;
  }
  return factor;
}

function hasAny(words: ReadonlySet<string>, candidates: readonly string[]): boolean {
  return candidates.some((word) => words.has(word));
}

function isPrivateLike(node: ISamchonGraphNode, words: ReadonlySet<string>): boolean {
  const name = node.qualifiedName ?? node.name;
  return (
    name.startsWith("_") ||
    name.includes("._") ||
    hasAny(words, ["inner", "internal", "private"])
  );
}

function hasExplicitSymbolHandle(query: string): boolean {
  return /`[^`]+`/.test(query) || /\b[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*\b/.test(query);
}

// Tests, examples, fixtures, generated output, and build artifacts are noise
// for tour seeding (ported from the reference isSupportPath).
function isNoisePath(file: string): boolean {
  return (
    file === "" ||
    file.startsWith("bundled://") ||
    /(^|\/)node_modules\//.test(file) ||
    /(^|\/)(test|tests|__tests__|spec|sample|samples|fixture|fixtures|__fixtures__|example|examples)\//.test(
      file,
    ) ||
    /\.(test|spec)\.[cm]?[tj]sx?$/.test(file) ||
    /(^|\/)typings\.[cm]?ts$/.test(file) ||
    /\.d\.[cm]?ts$/.test(file) ||
    /(^|\/)(dist|build|coverage|generated|__generated__)\//.test(file)
  );
}

function subwords(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
}

function stemWord(word: string): string {
  for (const suffix of ["ing", "ed", "es", "s"]) {
    if (word.length > suffix.length + 3 && word.endsWith(suffix)) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
}

function commonPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

function uniqueIds(ids: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
