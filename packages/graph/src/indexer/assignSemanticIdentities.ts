import {
  IGraphSemanticIdentity,
  callableBaseOf,
  semanticGraphNodeId,
} from "../provider/semanticIdentity";
import {
  ISamchonGraphEdge,
  ISamchonGraphEvidence,
  ISamchonGraphNode,
} from "../structures";

/**
 * Give best-effort non-TypeScript declarations intrinsic ids before dedupe.
 *
 * A generic LSP/static producer has no durable native symbol handle. A
 * decorated callable signature is still persistent; an undecorated callable,
 * local, or anonymous declaration is explicitly generation-scoped instead of
 * pretending its source coordinate is stable.
 */
export function assignSemanticIdentities(
  nodes: ISamchonGraphNode[],
  edges: ISamchonGraphEdge[] = [],
): void {
  const remap = new Map<string, IRemappedNode[]>();
  for (const node of nodes) {
    const identity = genericIdentityOf(node);
    if (identity === undefined) continue;
    const oldId = node.id;
    node.id = semanticGraphNodeId(identity, node.qualifiedName ?? node.name);
    push(remap, oldId, { node, id: node.id });
  }
  for (const edge of edges) {
    edge.from = endpointOf(edge.from, remap.get(edge.from), edge.evidence, "from");
    edge.to = endpointOf(edge.to, remap.get(edge.to), edge.evidence, "to");
  }
}

function genericIdentityOf(
  node: ISamchonGraphNode,
): IGraphSemanticIdentity | undefined {
  if (
    node.language === "typescript" ||
    node.language === "unknown" ||
    node.kind === "file" ||
    node.kind === "package" ||
    node.kind === "external_symbol"
  ) {
    return undefined;
  }
  const qualified = node.qualifiedName ?? node.name;
  const callable = CALLABLE_KINDS.has(node.kind);
  const overload = callable ? overloadOf(qualified) : undefined;
  const generationScoped =
    node.closure === true ||
    anonymousName(node.name) ||
    (callable && overload === undefined) ||
    (node.kind === "parameter" && !qualified.includes("("));
  const scope = scopeOf(node);
  return {
    version: 2,
    language: node.language,
    symbol: callable ? callableBaseOf(qualified) : qualified,
    role: node.kind,
    ...(scope === undefined ? {} : { scope }),
    ...(overload === undefined ? {} : { overload }),
    stability: generationScoped ? "generation" : "persistent",
    ...(generationScoped ? { generation: generationOf(node) } : {}),
  };
}

function scopeOf(
  node: ISamchonGraphNode,
): IGraphSemanticIdentity.IScope | undefined {
  if (node.file === "") return undefined;
  if (node.language === "c" || node.language === "cpp") {
    return { translationUnit: node.file };
  }
  return { document: node.file };
}

function overloadOf(name: string): string | undefined {
  const open = name.indexOf("(");
  if (open < 0) return undefined;
  return name.slice(open).replace(/\s+/g, " ").trim();
}

function generationOf(node: ISamchonGraphNode): string {
  const evidence = node.evidence;
  return [
    evidence?.file ?? node.file,
    evidence?.startLine ?? 0,
    evidence?.startCol ?? 0,
    node.qualifiedName ?? node.name,
  ].join("\0");
}

function anonymousName(name: string): boolean {
  return (
    /anonymous/i.test(name) ||
    /^new\s.+\{/.test(name) ||
    /^<.+>$/.test(name) ||
    /^\$\d+$/.test(name)
  );
}

function endpointOf(
  current: string,
  candidates: readonly IRemappedNode[] | undefined,
  evidence: ISamchonGraphEvidence | undefined,
  side: "from" | "to",
): string {
  if (candidates === undefined || candidates.length === 0) return current;
  if (candidates.length === 1) return candidates[0]!.id;
  const exact = candidates.filter(({ node }) =>
    sameStart(node.evidence, evidence),
  );
  if (exact.length === 1) return exact[0]!.id;
  if (side === "from" && evidence !== undefined) {
    const owner = candidates.filter(({ node }) => contains(node, evidence));
    if (owner.length === 1) return owner[0]!.id;
  }
  return [...candidates].sort((left, right) => compareText(left.id, right.id))[0]!
    .id;
}

function sameStart(
  left: ISamchonGraphEvidence | undefined,
  right: ISamchonGraphEvidence | undefined,
): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    left.file === right.file &&
    left.startLine === right.startLine &&
    (left.startCol ?? 0) === (right.startCol ?? 0)
  );
}

function contains(
  owner: ISamchonGraphNode,
  evidence: ISamchonGraphEvidence,
): boolean {
  const span = owner.evidence;
  return (
    span !== undefined &&
    span.file === evidence.file &&
    span.startLine <= evidence.startLine &&
    (span.endLine ?? span.startLine) >= evidence.startLine
  );
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const bucket = map.get(key);
  if (bucket === undefined) map.set(key, [value]);
  else bucket.push(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

interface IRemappedNode {
  node: ISamchonGraphNode;
  id: string;
}

const CALLABLE_KINDS = new Set(["function", "method", "constructor"]);
