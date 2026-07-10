import { SamchonGraphMemory } from "../SamchonGraphMemory";
import {
  ISamchonGraphEdge,
  ISamchonGraphNode,
  ISamchonGraphTrace,
} from "../structures";
import {
  bound,
  isExecution,
  isTestPath,
  isTypeEdge,
  publicEvidence,
  resolveHandle,
  resultGuide,
  resultNext,
  signatureOf,
} from "./common";

const DEFAULT_DEPTH = 2;
const DEFAULT_MAX_NODES = 6;
const MAX_OPEN_DEPTH = 2;
const MAX_OPEN_NODES = 8;
const MAX_IMPACT_DEPTH = 4;
const MAX_IMPACT_NODES = 16;
const MAX_HOPS_PER_NODE = 2;
const MAX_STEPS = 6;
const MAX_PATH_DEPTH = 12;

/**
 * Breadth-first trace along the dependency graph. Structural
 * (contains/exports/imports) edges are excluded so the path is real call/type
 * flow; forward walks callees, reverse and impact walk callers. Impact
 * additionally tags each reached node's role so the blast radius on the public
 * surface is legible.
 */
export function runTrace(
  graph: SamchonGraphMemory,
  props: ISamchonGraphTrace.IRequest,
): ISamchonGraphTrace {
  const direction = props.direction ?? "forward";
  const focus = props.focus ?? "all";
  const impact = direction === "impact";
  const maxDepth = bound(
    props.maxDepth,
    DEFAULT_DEPTH,
    1,
    impact ? MAX_IMPACT_DEPTH : MAX_OPEN_DEPTH,
  );
  const maxNodes = bound(
    props.maxNodes,
    DEFAULT_MAX_NODES,
    1,
    impact ? MAX_IMPACT_NODES : MAX_OPEN_NODES,
  );
  const maxHops = maxNodes * MAX_HOPS_PER_NODE;
  const reverse = direction === "reverse" || direction === "impact";
  const includeExternal = props.includeExternal === true;
  // Only an impact trace tags reached nodes with their public-surface role; for
  // forward/reverse the role is noise.
  const withRoles = direction === "impact";

  const start = resolveHandle(graph, props.from);
  if (start.candidates !== undefined) {
    return {
      type: "trace",
      direction,
      hops: [],
      reached: [],
      truncated: false,
      next: resultNext(
        "clarify",
        "The start handle is ambiguous; choose one returned candidate.",
      ),
      guide: resultGuide(
        "Disambiguate with the returned candidates, or ask the user for the intended symbol.",
      ),
      candidates: start.candidates.map((node) => traceNode(graph, node)),
    };
  }
  if (start.node === undefined) {
    return {
      type: "trace",
      direction,
      hops: [],
      reached: [],
      truncated: false,
      next: resultNext(
        "clarify",
        "The start handle did not resolve in the graph.",
      ),
      guide: resultGuide(
        "The start symbol was not resolved; answer that the graph has no trace from this handle.",
      ),
    };
  }

  // Path mode: with `to`, return the dependency path from `from` to `to`, the
  // one-call answer for "how does A reach B", instead of an open-ended trace.
  if (props.to !== undefined && props.to.trim() !== "") {
    const target = resolveHandle(graph, props.to);
    const startNode = traceNode(graph, start.node);
    // Mirror the start handle: an ambiguous or unresolved target must ask to
    // clarify, not report an empty path with next: "answer" (which reads as
    // "no flow exists").
    if (target.candidates !== undefined) {
      return {
        type: "trace",
        direction: "path",
        start: startNode,
        hops: [],
        reached: [],
        truncated: false,
        next: resultNext(
          "clarify",
          "The target handle is ambiguous; choose one candidate.",
        ),
        guide: resultGuide("Disambiguate the target with returned candidates."),
        candidates: target.candidates.map((node) => traceNode(graph, node)),
      };
    }
    if (target.node === undefined) {
      return {
        type: "trace",
        direction: "path",
        start: startNode,
        hops: [],
        reached: [],
        truncated: false,
        next: resultNext(
          "clarify",
          "The target handle did not resolve in the graph.",
        ),
        guide: resultGuide("Answer that the graph has no path to this target."),
      };
    }
    const found = findPath(
      graph,
      start.node.id,
      target.node.id,
      bound(props.maxDepth, MAX_PATH_DEPTH, 1, MAX_PATH_DEPTH),
      focus,
      includeExternal,
    );
    return {
      type: "trace",
      direction: "path",
      start: startNode,
      target: traceNode(graph, target.node),
      path: (found?.path ?? []).map((node, depth) =>
        traceNode(graph, node, depth, true),
      ),
      hops: found?.hops ?? [],
      reached: [],
      truncated: false,
      steps: steps(graph, found?.hops ?? []),
      next: resultNext(
        "answer",
        "The path result is the structural flow answer; cite path nodes and evidence ranges.",
      ),
      guide: resultGuide(
        "Use the returned path, hops, and evidence ranges as the flow answer.",
      ),
    };
  }

  const hops: ISamchonGraphTrace.IHop[] = [];
  const reached = new Map<string, ISamchonGraphTrace.INode>();
  const visited = new Set<string>([start.node.id]);
  let queue: Array<{ id: string; depth: number }> = [
    { id: start.node.id, depth: 0 },
  ];
  let truncated = false;

  while (queue.length > 0) {
    const next: Array<{ id: string; depth: number }> = [];
    for (const { id, depth } of queue) {
      if (depth >= maxDepth) {
        truncated = true;
        continue;
      }
      const edges = orderedEdges(
        graph,
        reverse ? graph.incoming(id) : graph.outgoing(id),
        impact,
        reverse,
      ).filter((edge) => traversable(edge, focus));
      for (const edge of edges) {
        const otherId = reverse ? edge.from : edge.to;
        const other = graph.node(otherId);
        if (other === undefined || other.kind === "file") continue;
        if (!includeExternal && other.external) continue;
        const hop = hopOf(edge, depth + 1);
        // A back-edge to the start or an already-reached node: record the hop;
        // its endpoints are already represented.
        if (visited.has(otherId)) {
          if (hops.length >= maxHops) truncated = true;
          else hops.push(hop);
          continue;
        }
        // A new node past the cap is left unrepresented, so drop its hop too:
        // every hop's endpoints stay resolvable in `reached`/`start`.
        if (reached.size >= maxNodes) {
          truncated = true;
          continue;
        }
        if (hops.length >= maxHops) {
          truncated = true;
          continue;
        }
        visited.add(otherId);
        reached.set(otherId, traceNode(graph, other, depth + 1, false, withRoles));
        next.push({ id: otherId, depth: depth + 1 });
        hops.push(hop);
      }
    }
    queue = next;
  }

  return {
    type: "trace",
    start: traceNode(graph, start.node),
    direction,
    hops,
    reached: [...reached.values()],
    truncated,
    steps: steps(graph, hops),
    next: resultNext(
      "answer",
      "Steps, hops, reached nodes, and evidence ranges are the flow answer surface.",
    ),
    guide: resultGuide(
      "Use steps, hops, reached nodes, and evidence ranges as the flow answer or reading-list anchor.",
    ),
  };
}

/**
 * The shortest dependency path from `startId` to `targetId` over real (non-
 * structural) forward edges, breadth-first, or null when `targetId` is not
 * reachable within maxDepth. Returns the nodes in order and the hops between.
 */
function findPath(
  graph: SamchonGraphMemory,
  startId: string,
  targetId: string,
  maxDepth: number,
  focus: ISamchonGraphTrace.IRequest["focus"],
  includeExternal: boolean,
): { path: ISamchonGraphNode[]; hops: ISamchonGraphTrace.IHop[] } | null {
  const startNode = graph.node(startId);
  // The caller already resolved startId to a real node in this same graph.
  /* c8 ignore next */
  if (startNode === undefined) return null;
  if (startId === targetId) return { path: [startNode], hops: [] };
  const parent = new Map<string, { from: string; edge: ISamchonGraphEdge }>();
  const queue: Array<{ id: string; depth: number }> = [
    { id: startId, depth: 0 },
  ];
  const visited = new Set<string>([startId]);
  while (queue.length > 0) {
    const item = queue.shift()!;
    /* c8 ignore next */
    if (item.depth >= maxDepth) continue;
    for (const edge of graph.outgoing(item.id)) {
      if (!traversable(edge, focus)) continue;
      const other = graph.node(edge.to);
      if (other === undefined || other.kind === "file") continue;
      if (!includeExternal && other.external) continue;
      if (visited.has(edge.to)) continue;
      visited.add(edge.to);
      parent.set(edge.to, { from: item.id, edge });
      if (edge.to === targetId) {
        const ids = [targetId];
        let cursor = targetId;
        while (cursor !== startId) {
          const p = parent.get(cursor)!;
          ids.unshift(p.from);
          cursor = p.from;
        }
        const nodes = ids
          .map((id) => graph.node(id))
          .filter((node): node is ISamchonGraphNode => node !== undefined);
        const pathHops: ISamchonGraphTrace.IHop[] = [];
        for (let i = 1; i < ids.length; i++) {
          const p = parent.get(ids[i]!);
          if (p !== undefined) pathHops.push(hopOf(p.edge, i));
        }
        return { path: nodes, hops: pathHops };
      }
      queue.push({ id: edge.to, depth: item.depth + 1 });
    }
  }
  return null;
}

/**
 * Order edges before traversal. A normal trace ranks by edge kind, then the
 * traversed endpoint's declaration kind, then evidence position; an impact
 * trace ranks reached endpoints by public-surface role first so the blast
 * radius on the exported/test surface leads.
 */
// Impact always traverses incoming edges, so its ranked endpoint is always
// the edge's `from`.
function orderedEdges(
  graph: SamchonGraphMemory,
  edges: readonly ISamchonGraphEdge[],
  impact: boolean,
  reverse: boolean,
): readonly ISamchonGraphEdge[] {
  if (!impact)
    return [...edges].sort(
      (a, b) =>
        edgeKindRank(a.kind) - edgeKindRank(b.kind) ||
        traceEndpointRank(graph, reverse ? a.from : a.to) -
          traceEndpointRank(graph, reverse ? b.from : b.to) ||
        evidenceRank(a) - evidenceRank(b),
    );
  return [...edges].sort(
    (a, b) =>
      impactEndpointRank(graph, a.from) - impactEndpointRank(graph, b.from) ||
      edgeKindRank(a.kind) - edgeKindRank(b.kind) ||
      evidenceRank(a) - evidenceRank(b),
  );
}

function impactEndpointRank(graph: SamchonGraphMemory, id: string): number {
  const node = graph.node(id);
  // `id` is always an endpoint of a real graph edge, so it resolves.
  /* c8 ignore next */
  if (node === undefined) return 9;
  if (isTestPath(node.file)) return 0;
  if (node.exported) return 1;
  if (node.external || node.ignored) return 4;
  return 2;
}

function traceEndpointRank(graph: SamchonGraphMemory, id: string): number {
  const node = graph.node(id);
  if (node === undefined) return 9;
  if (isTestPath(node.file)) return 6;
  switch (node.kind) {
    case "function":
    case "method":
    case "class":
      return 0;
    case "variable":
      return 1;
    case "property":
      return 2;
    case "interface":
    case "type":
      return 4;
    default:
      return 3;
  }
}

/** An edge the trace should follow: a real dependency, not a structural edge. */
function traversable(
  edge: ISamchonGraphEdge,
  focus: ISamchonGraphTrace.IRequest["focus"],
): boolean {
  if (
    edge.kind === "contains" ||
    edge.kind === "exports" ||
    edge.kind === "imports"
  ) {
    return false;
  }
  if (focus === "execution") return isExecution(edge.kind);
  if (focus === "types") return isTypeEdge(edge.kind);
  return true;
}

function hopOf(edge: ISamchonGraphEdge, depth: number): ISamchonGraphTrace.IHop {
  return {
    from: edge.from,
    to: edge.to,
    kind: edge.kind,
    depth,
    ...(edge.evidence !== undefined
      ? { evidence: publicEvidence(edge.evidence) }
      : {}),
  };
}

/**
 * Summarize a node for a trace result. With `withRoles`, tag the public-surface
 * roles (exported / test) an impact trace reports; other directions omit them.
 */
function traceNode(
  graph: SamchonGraphMemory,
  node: ISamchonGraphNode,
  depth?: number,
  withSignature = false,
  withRoles = false,
): ISamchonGraphTrace.INode {
  const out: ISamchonGraphTrace.INode = {
    id: node.id,
    name: node.qualifiedName ?? node.name,
    kind: node.kind,
    file: node.file,
  };
  if (node.evidence?.startLine !== undefined) out.line = node.evidence.startLine;
  const span = node.implementation ?? node.evidence;
  if (span !== undefined) {
    out.sourceSpan = {
      file: span.file,
      startLine: span.startLine,
      ...(span.endLine !== undefined ? { endLine: span.endLine } : {}),
    };
  }
  if (depth !== undefined) out.depth = depth;
  if (withSignature) {
    const signature = signatureOf(graph.project, node);
    if (signature !== undefined) out.signature = signature;
  }
  if (withRoles) {
    const roles: string[] = [];
    if (node.exported) roles.push("exported");
    if (isTestPath(node.file)) roles.push("test");
    if (roles.length > 0) out.roles = roles;
  }
  return out;
}

function steps(
  graph: SamchonGraphMemory,
  hops: readonly ISamchonGraphTrace.IHop[],
): string[] {
  return hops.slice(0, MAX_STEPS).map((hop) => {
    const from = graph.node(hop.from);
    const to = graph.node(hop.to);
    // Every hop's endpoints came from a real edge in this same graph.
    /* c8 ignore next 2 */
    const lhs = from?.qualifiedName ?? from?.name ?? hop.from;
    const rhs = to?.qualifiedName ?? to?.name ?? hop.to;
    const at =
      hop.evidence === undefined
        ? ""
        : ` at ${hop.evidence.file}:${hop.evidence.startLine}`;
    return `${lhs} -[${hop.kind}${at}]-> ${rhs}`;
  });
}

function edgeKindRank(kind: string): number {
  switch (kind) {
    case "calls":
      return 0;
    case "instantiates":
      return 1;
    case "renders":
      return 2;
    case "accesses":
    case "references":
      return 3;
    case "tests":
      return 4;
    case "overrides":
    case "decorates":
      return 5;
    case "extends":
    case "implements":
      return 6;
    case "type_ref":
      return 7;
    default:
      return 10;
  }
}

function evidenceRank(edge: ISamchonGraphEdge): number {
  const line = edge.evidence?.startLine ?? 9_999;
  const col = edge.evidence?.startCol ?? 999;
  return line * 100 + col;
}
