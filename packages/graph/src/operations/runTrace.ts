import { GraphMemory } from "../model/GraphMemory";
import { IGraphEdge, IGraphNode, IGraphTrace } from "../structures";
import {
  bound,
  compareEdges,
  edgeRank,
  isExecution,
  isTestPath,
  isTypeEdge,
  publicEvidence,
  resolveHandle,
  resultGuide,
  resultNext,
  signatureOf,
  summaryOf,
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
  graph: GraphMemory,
  props: IGraphTrace.IRequest,
): IGraphTrace {
  const direction = props.direction ?? "forward";
  const focus = props.focus ?? "all";
  const impact = direction === "impact";
  const reverse = direction === "reverse" || direction === "impact";
  const includeExternal = props.includeExternal === true;
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

  const start = resolveHandle(graph, props.from);
  if (start.candidates !== undefined) {
    return {
      type: "trace",
      direction,
      hops: [],
      reached: [],
      truncated: false,
      candidates: start.candidates.map((node) => traceNode(graph, node)),
      next: resultNext("clarify", "The start handle is ambiguous; choose one candidate."),
      guide: resultGuide("Disambiguate with returned candidates."),
    };
  }
  if (start.node === undefined) {
    return {
      type: "trace",
      direction,
      hops: [],
      reached: [],
      truncated: false,
      next: resultNext("clarify", "The start handle did not resolve in the graph."),
      guide: resultGuide("Answer that the graph has no trace from this handle."),
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
        candidates: target.candidates.map((node) => traceNode(graph, node)),
        next: resultNext("clarify", "The target handle is ambiguous; choose one candidate."),
        guide: resultGuide("Disambiguate the target with returned candidates."),
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
        next: resultNext("clarify", "The target handle did not resolve in the graph."),
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
      path: (found?.path ?? []).map((node, depth) => traceNode(graph, node, depth, true)),
      hops: found?.hops ?? [],
      reached: [],
      truncated: false,
      steps: steps(graph, found?.hops ?? []),
      next: resultNext(
        "answer",
        "The path result is the flow answer; cite path nodes and evidence ranges.",
      ),
      guide: resultGuide("Use path, hops, and evidence as the flow answer."),
    };
  }

  const hops: IGraphTrace.IHop[] = [];
  const reached = new Map<string, IGraphTrace.INode>();
  const visited = new Set<string>([start.node.id]);
  let queue: Array<{ id: string; depth: number }> = [{ id: start.node.id, depth: 0 }];
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
        reached.set(otherId, traceNode(graph, other, depth + 1, false, impact));
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
    guide: resultGuide("Use steps, hops, reached nodes, and evidence ranges as the flow answer."),
  };
}

function findPath(
  graph: GraphMemory,
  startId: string,
  targetId: string,
  maxDepth: number,
  focus: IGraphTrace.IRequest["focus"],
  includeExternal: boolean,
): { path: IGraphNode[]; hops: IGraphTrace.IHop[] } | null {
  const parent = new Map<string, { from: string; edge: IGraphEdge }>();
  const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];
  const visited = new Set<string>([startId]);
  while (queue.length > 0) {
    const item = queue.shift()!;
    /* c8 ignore next */
    if (item.depth >= maxDepth) continue;
    for (const edge of graph.outgoing(item.id).filter((e) => traversable(e, focus)).sort(compareEdges)) {
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
          .filter((node): node is IGraphNode => node !== undefined);
        const pathHops: IGraphTrace.IHop[] = [];
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
 * Order edges before traversal. A normal trace ranks by edge kind then
 * evidence; an impact trace ranks reached endpoints by public-surface role
 * first so the blast radius on the exported/test surface leads.
 */
// Only the impact BFS orders edges here, and it always traverses incoming
// edges, so the ranked endpoint is the edge's `from`.
function orderedEdges(
  graph: GraphMemory,
  edges: readonly IGraphEdge[],
  impact: boolean,
): readonly IGraphEdge[] {
  if (!impact) return [...edges].sort(compareEdges);
  return [...edges].sort(
    (a, b) =>
      impactEndpointRank(graph, a.from) - impactEndpointRank(graph, b.from) ||
      edgeRank(a.kind) - edgeRank(b.kind) ||
      (a.evidence?.startLine ?? 999_999) - (b.evidence?.startLine ?? 999_999),
  );
}

function impactEndpointRank(graph: GraphMemory, id: string): number {
  const node = graph.node(id);
  // `id` is always an endpoint of a real graph edge, so it resolves.
  /* c8 ignore next */
  if (node === undefined) return 9;
  if (isTestPath(node.file)) return 0;
  if (node.exported) return 1;
  if (node.external || node.ignored) return 4;
  return 2;
}

function traversable(edge: IGraphEdge, focus: IGraphTrace.IRequest["focus"]): boolean {
  if (edge.kind === "contains" || edge.kind === "exports" || edge.kind === "imports") {
    return false;
  }
  if (focus === "execution") return isExecution(edge.kind);
  if (focus === "types") return isTypeEdge(edge.kind);
  return true;
}

function hopOf(edge: IGraphEdge, depth: number): IGraphTrace.IHop {
  return {
    from: edge.from,
    to: edge.to,
    kind: edge.kind,
    depth,
    ...(edge.evidence !== undefined ? { evidence: publicEvidence(edge.evidence) } : {}),
  };
}

function traceNode(
  graph: GraphMemory,
  node: IGraphNode,
  depth?: number,
  withSignature = false,
  withRoles = false,
): IGraphTrace.INode {
  const out: IGraphTrace.INode = {
    ...summaryOf(node),
    ...(depth !== undefined ? { depth } : {}),
  };
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

function steps(graph: GraphMemory, hops: readonly IGraphTrace.IHop[]): string[] {
  return hops.slice(0, MAX_STEPS).map((hop) => {
    const from = graph.node(hop.from)!;
    const to = graph.node(hop.to)!;
    const lhs = from.qualifiedName ?? from.name;
    const rhs = to.qualifiedName ?? to.name;
    const at =
      hop.evidence === undefined ? "" : ` at ${hop.evidence.file}:${hop.evidence.startLine}`;
    return `${lhs} -[${hop.kind}${at}]-> ${rhs}`;
  });
}
