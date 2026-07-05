import path from "node:path";

import { GraphMemory } from "../model/GraphMemory";
import {
  GraphEdgeKind,
  IGraphDetails,
  IGraphEdge,
  IGraphEvidence,
  IGraphNext,
  IGraphNode,
  IGraphOverview,
} from "../structures";
import { readLines } from "../utils/fs";

export function resultNext(
  action: IGraphNext["action"],
  reason: string,
  request?: IGraphNext["request"],
): IGraphNext {
  return request === undefined ? { action, reason } : { action, request, reason };
}

export function resultGuide(message: string): string {
  return `${message} Use graph spans as citation anchors; do not treat them as a command to read source bodies.`;
}

export function isStructural(kind: string): boolean {
  return kind === "contains" || kind === "exports" || kind === "imports";
}

export function isExecution(kind: string): boolean {
  return (
    kind === "calls" ||
    kind === "instantiates" ||
    kind === "accesses" ||
    kind === "renders" ||
    kind === "references"
  );
}

export function isTypeEdge(kind: string): boolean {
  return (
    kind === "type_ref" ||
    kind === "extends" ||
    kind === "implements" ||
    kind === "overrides" ||
    kind === "decorates"
  );
}

export function summaryOf(node: IGraphNode): IGraphOverview.INode {
  const out: IGraphOverview.INode = {
    id: node.id,
    name: node.qualifiedName ?? node.name,
    kind: node.kind,
    language: node.language,
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
  return out;
}

export function resolveHandle(
  graph: GraphMemory,
  handle: string,
): { node?: IGraphNode; candidates?: IGraphNode[] } {
  const trimmed = handle.trim();
  if (trimmed === "") return {};
  const exact = graph.node(trimmed);
  if (exact !== undefined) return { node: exact };
  const symbolMatches = graph.symbols(trimmed);
  if (symbolMatches.length === 1) return { node: symbolMatches[0] };
  if (symbolMatches.length > 1) return { candidates: symbolMatches.slice(0, 8) };
  const nameMatches = graph.named(trimmed);
  const symbolOnly = nameMatches.filter((node) => node.kind !== "file");
  if (symbolOnly.length === 1) return { node: symbolOnly[0] };
  if (symbolOnly.length > 1) return { candidates: symbolOnly.slice(0, 8) };
  const lowered = trimmed.toLowerCase();
  const fuzzy = graph.nodes
    .filter(
      (node) =>
        node.kind !== "file" &&
        ((node.qualifiedName ?? node.name).toLowerCase().endsWith(lowered) ||
          node.file.toLowerCase().endsWith(lowered)),
    )
    .slice(0, 8);
  if (fuzzy.length === 1) return { node: fuzzy[0] };
  if (fuzzy.length > 1) return { candidates: fuzzy };
  return {};
}

export function referencesFromEdges(
  graph: GraphMemory,
  edges: readonly IGraphEdge[],
  end: "from" | "to",
  limit: number,
  includeExternal: boolean,
  kinds?: ReadonlySet<string>,
): IGraphDetails.IReference[] {
  const out: IGraphDetails.IReference[] = [];
  const seen = new Set<string>();
  for (const edge of [...edges].sort(compareEdges)) {
    if (kinds !== undefined && !kinds.has(edge.kind)) continue;
    if (isStructural(edge.kind)) continue;
    const node = graph.node(end === "from" ? edge.from : edge.to);
    if (node === undefined) continue;
    if (!includeExternal && node.external) continue;
    const key = `${edge.kind}:${node.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ref: IGraphDetails.IReference = {
      ...summaryOf(node),
      relation: edge.kind,
    };
    if (edge.evidence !== undefined) ref.evidence = publicEvidence(edge.evidence);
    out.push(ref);
    if (out.length >= limit) break;
  }
  return out;
}

export function signatureOf(project: string, node: IGraphNode): string | undefined {
  if (node.signature !== undefined && node.signature.trim() !== "") {
    return compactSignature(node.signature);
  }
  if (node.evidence === undefined || node.file === "") return undefined;
  const lines = readLines(path.join(project, node.evidence.file));
  if (lines === undefined) return undefined;
  const start = Math.max(0, node.evidence.startLine - 1);
  const end =
    node.evidence.endLine === undefined
      ? Math.min(lines.length, start + 4)
      : Math.min(lines.length, node.evidence.endLine);
  const out: string[] = [];
  for (let i = start; i < end && out.length < 4; i++) {
    const line = lines[i];
    if (line === undefined) break;
    out.push(line);
    const trimmed = line.trimEnd();
    if (trimmed.endsWith(";") || trimmed.endsWith("{") || trimmed.endsWith("}")) {
      break;
    }
  }
  const text = out.join("\n").trim();
  return text === "" ? undefined : compactSignature(text);
}

export function publicEvidence(evidence: IGraphEvidence): IGraphEvidence {
  return {
    file: evidence.file,
    startLine: evidence.startLine,
    ...(evidence.startCol !== undefined ? { startCol: evidence.startCol } : {}),
    ...(evidence.endLine !== undefined ? { endLine: evidence.endLine } : {}),
    ...(evidence.endCol !== undefined ? { endCol: evidence.endCol } : {}),
  };
}

export function compareEdges(a: IGraphEdge, b: IGraphEdge): number {
  return (
    edgeRank(a.kind) - edgeRank(b.kind) ||
    (a.evidence?.startLine ?? 999_999) - (b.evidence?.startLine ?? 999_999) ||
    (a.evidence?.startCol ?? 999) - (b.evidence?.startCol ?? 999)
  );
}

export function edgeRank(kind: string): number {
  switch (kind satisfies string as GraphEdgeKind | string) {
    case "calls":
      return 0;
    case "instantiates":
      return 1;
    case "references":
    case "accesses":
      return 2;
    case "type_ref":
      return 3;
    case "extends":
    case "implements":
    case "overrides":
      return 4;
    case "tests":
      return 5;
    default:
      return 10;
  }
}

export function subwords(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9_$]+/)
    .map((word) => word.toLowerCase())
    .filter((word) => word.length > 0);
}

export function isTestPath(file: string): boolean {
  return (
    /(^|\/)(test|tests|__tests__|spec)\//.test(file) ||
    /\.(test|spec)\./.test(file) ||
    /_test\./.test(file)
  );
}

export function bound(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = value === undefined || !Number.isFinite(value) ? fallback : value;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function compactSignature(text: string): string {
  return text
    .split(/\r?\n/)
    .slice(0, 4)
    .join("\n")
    .replace(/\s+$/gm, "")
    .trim();
}
