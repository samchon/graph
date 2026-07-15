import { SamchonGraphMemory } from "../SamchonGraphMemory";
import {
  ISamchonGraphDetails,
  ISamchonGraphEdge,
  ISamchonGraphEvidence,
  ISamchonGraphNode,
} from "../structures";
import { bound } from "./bound";
import { decoratorsOf } from "./decoratorsOf";
import { docOf } from "./docOf";
import { edgeEvidenceOf } from "./edgeEvidenceOf";
import { fileLines } from "./fileLines";
import { isExternalNode } from "./isExternalNode";
import { isStructural } from "./isStructural";
import { isTestPath } from "./isTestPath";
import { publicEvidence } from "./publicEvidence";
import { resolveGraphHandle } from "./resolveGraphHandle";
import { IRunnerOutput } from "./IRunnerOutput";
import { resultNext } from "./resultNext";
import { signatureOf } from "./signatureOf";

// Neighbor lists are a map, not a dump; keep them scannable.
const DEFAULT_NEIGHBORS = 2;
const MAX_NEIGHBORS = 3;
// A container outline can be long; default to a scannable first page.
const DEFAULT_MEMBERS = 6;
const MAX_MEMBERS = 8;
// Direct dependency groups are orientation slices, not full fan-out dumps.
const DEFAULT_DEPENDENCIES = 2;
const MAX_DEPENDENCIES = 4;
// Object literal outlines are navigation aids, not source excerpts.
const MAX_OBJECT_MEMBER_LINES = 300;
// Kinds whose value is their member outline, not implementation text.
const CONTAINER_KINDS = new Set<string>([
  "class",
  "interface",
  "namespace",
  "module",
  "enum",
  "file",
]);

/**
 * Resolve each handle to its declared shape: sourceSpan anchors, signature,
 * direct dependencies, and for containers, member outlines. It answers from the
 * graph's resolved structure instead of inlining implementation bodies.
 */
export function runDetails(
  graph: SamchonGraphMemory,
  props: ISamchonGraphDetails.IRequest,
): IRunnerOutput<ISamchonGraphDetails> {
  const neighborLimit = bound(
    props.neighborLimit,
    DEFAULT_NEIGHBORS,
    1,
    MAX_NEIGHBORS,
  );
  const memberLimit = bound(props.memberLimit, DEFAULT_MEMBERS, 1, MAX_MEMBERS);
  const dependencyLimit = bound(
    props.dependencyLimit,
    DEFAULT_DEPENDENCIES,
    1,
    MAX_DEPENDENCIES,
  );
  const wantNeighbors = props.neighbors === true;
  const includeExternal = props.includeExternal === true;
  const nodes: ISamchonGraphDetails.INode[] = [];
  const unknown: string[] = [];
  const ambiguous: ISamchonGraphDetails.IAmbiguity[] = [];
  for (const handle of props.handles) {
    const resolved = resolveGraphHandle(graph, handle);
    if (resolved.node === undefined) {
      // A handle the graph knows twice is not a handle the graph does not know.
      // Hand back the nodes it named and let the caller pick one; calling it
      // unknown sends the caller to the files for facts already in the index.
      if (resolved.candidates !== undefined && resolved.candidates.length > 0) {
        ambiguous.push({
          handle,
          candidates: resolved.candidates.map((node) => ({
            id: node.id,
            name: node.qualifiedName ?? node.name,
            kind: node.kind,
            file: node.file,
            ...(node.evidence?.startLine !== undefined
              ? { line: node.evidence.startLine }
              : {}),
          })),
        });
        continue;
      }
      unknown.push(handle);
      continue;
    }
    const node = resolved.node;
    const detail: ISamchonGraphDetails.INode = {
      id: node.id,
      name: node.qualifiedName ?? node.name,
      kind: node.kind,
      file: node.file,
    };
    if (node.evidence?.startLine) detail.line = node.evidence.startLine;
    const sig = signatureOf(graph.project, node);
    if (sig !== undefined) detail.signature = sig;
    const doc = docOf(graph.project, node);
    if (doc !== undefined) detail.doc = doc;
    const signatureLiterals = literalSummaries(sig);
    const decorators = decoratorsOf(node);
    if (decorators !== undefined) detail.decorators = decorators;
    const implementation = evidenceCoordinatesOf(node.implementation);
    if (implementation !== undefined) detail.implementation = implementation;
    const span = implementation ?? evidenceCoordinatesOf(node.evidence);
    if (span !== undefined) {
      detail.sourceSpan = {
        file: span.file,
        startLine: span.startLine,
        endLine: span.endLine,
      };
    }
    const calls = dependencyRefs(
      graph,
      node,
      executionKinds,
      dependencyLimit,
      includeExternal,
    );
    if (calls.length > 0) detail.calls = calls;
    const types = dependencyRefs(
      graph,
      node,
      typeKinds,
      dependencyLimit,
      includeExternal,
    );
    if (types.length > 0) detail.types = types;
    const implementedBy = incomingDependencyRefs(
      graph,
      node,
      implementationKinds,
      dependencyLimit,
      includeExternal,
    );
    if (implementedBy.length > 0) detail.implementedBy = implementedBy;
    if (CONTAINER_KINDS.has(node.kind)) {
      const list = members(graph, node, memberLimit);
      if (list.length > 0) detail.members = list;
    }
    if (node.kind === "variable" && detail.sourceSpan !== undefined) {
      const list = objectLiteralMembers(
        graph.project,
        detail.sourceSpan,
        memberLimit,
      );
      if (list.length > 0) detail.members = list;
    }
    if (signatureLiterals.length > 0)
      detail.literals = signatureLiterals.slice(0, 6);
    if (wantNeighbors) {
      detail.dependsOn = refs(
        graph,
        graph.outgoing(node.id),
        "to",
        neighborLimit,
        includeExternal,
      );
      detail.dependedOnBy = refs(
        graph,
        graph.incoming(node.id),
        "from",
        neighborLimit,
        includeExternal,
      );
    }
    nodes.push(detail);
  }
  return {
    result: {
      type: "details",
      nodes,
      unknown,
      ...(ambiguous.length > 0 ? { ambiguous } : {}),
    },
    next:
      nodes.length === 0 && ambiguous.length > 0
        ? resultNext(
            "inspect",
            "Each handle names several nodes; re-call details with the id of the one the question means.",
            "details",
          )
        : nodes.length === 0
          ? resultNext(
              "outside",
              "No handle resolved to a node, so the graph holds nothing for them.",
            )
          : resultNext(
              "answer",
              "The signatures, members, dependencies, and sourceSpan anchors are what the graph holds on these symbols.",
            ),
  };
}

/** The members a container owns (via `contains`), each with its own signature. */
function members(
  graph: SamchonGraphMemory,
  node: ISamchonGraphNode,
  limit: number,
): ISamchonGraphDetails.IMember[] {
  const out: ISamchonGraphDetails.IMember[] = [];
  for (const edge of graph.outgoing(node.id)) {
    if (edge.kind !== "contains") continue;
    const member = graph.node(edge.to);
    if (member === undefined) continue;
    const m: ISamchonGraphDetails.IMember = {
      name: member.qualifiedName ?? member.name,
      kind: member.kind,
    };
    if (member.evidence?.startLine) m.line = member.evidence.startLine;
    const sig = signatureOf(graph.project, member);
    if (sig !== undefined) m.signature = sig;
    const decorators = decoratorsOf(member);
    if (decorators !== undefined) m.decorators = decorators;
    out.push(m);
    if (out.length >= limit) break;
  }
  return out;
}

function objectLiteralMembers(
  project: string,
  span: Pick<ISamchonGraphEvidence, "file" | "startLine" | "endLine">,
  limit: number,
): ISamchonGraphDetails.IMember[] {
  if (span.endLine === undefined) return [];
  if (span.endLine - span.startLine > MAX_OBJECT_MEMBER_LINES) return [];
  const lines = fileLines(project, span.file);
  if (lines === undefined) return [];
  const start = Math.max(0, span.startLine - 1);
  const end = Math.min(lines.length - 1, span.endLine - 1);
  const members: ISamchonGraphDetails.IMember[] = [];
  let depth = 0;
  let entered = false;
  for (let i = start; i <= end; i++) {
    // `end` is bounded by `lines.length - 1`, so `i` is always in range.
    /* c8 ignore next */
    const raw = lines[i] ?? "";
    const text = stripStrings(raw);
    const before = depth;
    if (entered && before === 1) {
      const member = objectMemberOf(raw, i + 1);
      if (member !== undefined) {
        members.push(member);
        if (members.length >= limit) break;
      }
    }
    for (const char of text) {
      if (char === "{") {
        depth++;
        entered = true;
      } else if (char === "}") {
        depth = Math.max(0, depth - 1);
      }
    }
  }
  return members;
}

function objectMemberOf(
  line: string,
  lineNumber: number,
): ISamchonGraphDetails.IMember | undefined {
  const text = line.trim();
  if (
    text === "" ||
    text.startsWith("//") ||
    text.startsWith("/*") ||
    text.startsWith("*")
  ) {
    return undefined;
  }
  const property = /^(['"]?)([A-Za-z_$][\w$-]*)\1\s*\??\s*:/.exec(text);
  if (property !== null) {
    return {
      name: property[2]!,
      kind: "property",
      line: lineNumber,
      signature: signatureLine(text),
    };
  }
  const method =
    /^(?:async\s+)?(?:get\s+|set\s+)?([A-Za-z_$][\w$-]*)\s*\(/.exec(text);
  if (method !== null) {
    return {
      name: method[1]!,
      kind: "method",
      line: lineNumber,
      signature: signatureLine(text),
    };
  }
  return undefined;
}

function signatureLine(text: string): string {
  return text.replace(/\s+/g, " ").replace(/,$/, "");
}

function stripStrings(line: string): string {
  return line.replace(/\/\/.*$/, "").replace(/(['"`])(?:\\.|(?!\1).)*\1/g, "");
}

/** Map dependency edges to references on their far endpoint, dropping structure. */
function refs(
  graph: SamchonGraphMemory,
  edges: readonly ISamchonGraphEdge[],
  end: "to" | "from",
  limit: number,
  includeExternal: boolean,
): ISamchonGraphDetails.IReference[] {
  const ranked: Array<{ ref: ISamchonGraphDetails.IReference; rank: number }> =
    [];
  for (const edge of edges) {
    if (isStructural(edge.kind)) continue;
    const other = graph.node(end === "to" ? edge.to : edge.from);
    if (other === undefined) continue;
    if (!includeExternal && isExternalNode(other)) continue;
    const ref: ISamchonGraphDetails.IReference = {
      id: other.id,
      name: other.qualifiedName ?? other.name,
      kind: other.kind,
      file: other.file,
      relation: edge.kind,
    };
    if (other.evidence?.startLine) ref.line = other.evidence.startLine;
    const evidence = edgeEvidenceOf(edge);
    if (evidence !== undefined) ref.evidence = evidence;
    ranked.push({ ref, rank: refRank(ref, edge) });
  }
  ranked.sort((a, b) => a.rank - b.rank);
  const out: ISamchonGraphDetails.IReference[] = [];
  for (const item of ranked) {
    out.push(item.ref);
    if (out.length >= limit) break;
  }
  return out;
}

const executionKinds = new Set([
  "calls",
  "instantiates",
  "accesses",
  "renders",
  "references",
]);
const typeKinds = new Set(["type_ref", "extends", "implements", "overrides"]);
const implementationKinds = new Set(["implements", "overrides"]);

function dependencyRefs(
  graph: SamchonGraphMemory,
  node: ISamchonGraphNode,
  kinds: ReadonlySet<string>,
  limit: number,
  includeExternal: boolean,
): ISamchonGraphDetails.IReference[] {
  const ranked: Array<{ ref: ISamchonGraphDetails.IReference; rank: number }> =
    [];
  for (const edge of graph.outgoing(node.id)) {
    if (!kinds.has(edge.kind)) continue;
    const other = graph.node(edge.to);
    if (other === undefined || other.kind === "file") continue;
    if (!includeExternal && isExternalNode(other)) continue;
    const name = other.qualifiedName ?? other.name;
    const ref: ISamchonGraphDetails.IReference = {
      id: other.id,
      name,
      kind: other.kind,
      file: other.file,
      relation: edge.kind,
    };
    if (other.evidence?.startLine) ref.line = other.evidence.startLine;
    const evidence = edgeEvidenceOf(edge);
    if (evidence !== undefined) ref.evidence = evidence;
    ranked.push({
      ref,
      rank: refRank(ref, edge),
    });
  }
  ranked.sort((a, b) => a.rank - b.rank);
  const out: ISamchonGraphDetails.IReference[] = [];
  const seen = new Set<string>();
  for (const item of ranked) {
    const key = `${item.ref.relation}:${item.ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item.ref);
    if (out.length >= limit) break;
  }
  return out;
}

function incomingDependencyRefs(
  graph: SamchonGraphMemory,
  node: ISamchonGraphNode,
  kinds: ReadonlySet<string>,
  limit: number,
  includeExternal: boolean,
): ISamchonGraphDetails.IReference[] {
  const ranked: Array<{ ref: ISamchonGraphDetails.IReference; rank: number }> =
    [];
  for (const edge of graph.incoming(node.id)) {
    if (!kinds.has(edge.kind)) continue;
    const other = graph.node(edge.from);
    if (other === undefined || other.kind === "file") continue;
    if (!includeExternal && isExternalNode(other)) continue;
    const ref: ISamchonGraphDetails.IReference = {
      id: other.id,
      name: other.qualifiedName ?? other.name,
      kind: other.kind,
      file: other.file,
      relation: edge.kind,
    };
    if (other.evidence?.startLine) ref.line = other.evidence.startLine;
    const evidence = edgeEvidenceOf(edge);
    if (evidence !== undefined) ref.evidence = evidence;
    ranked.push({
      ref,
      rank: refRank(ref, edge),
    });
  }
  ranked.sort((a, b) => a.rank - b.rank);
  const out: ISamchonGraphDetails.IReference[] = [];
  const seen = new Set<string>();
  for (const item of ranked) {
    const key = `${item.ref.relation}:${item.ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item.ref);
    if (out.length >= limit) break;
  }
  return out;
}

function literalSummaries(text: string | undefined): string[] {
  if (text === undefined) return [];
  const out: string[] = [];
  for (const match of text.matchAll(/(["'`])((?:\\.|(?!\1).){1,80})\1/g)) {
    const value = cleanLiteral(match[2]);
    if (value !== undefined && !out.includes(value)) out.push(value);
    if (out.length >= 20) break;
  }
  return out;
}

function cleanLiteral(value: string | undefined): string | undefined {
  const text = value?.replace(/\s+/g, " ").trim();
  if (
    text === undefined ||
    text === "" ||
    text.length > 40 ||
    /^[{}()[\],.:;]+$/.test(text)
  ) {
    return undefined;
  }
  return text;
}

/**
 * Which references a capped list keeps.
 *
 * Kind leads: what a symbol calls says more about it than what it names in a
 * type position. Within a kind the source order decides, which is a stable
 * tiebreak and nothing more — so a symbol with two hundred callers used to
 * answer with whichever two happened to be written nearest the top of their
 * file, and for Excalidraw's `mutateElement` those two were a sort test and a
 * duplication test. A test is not who runs the code in production, and the tour
 * already carries the tests it found in a section of their own, so a reference
 * from a test file ranks below every reference from the code under test.
 */
function refRank(
  ref: ISamchonGraphDetails.IReference,
  edge: ISamchonGraphEdge,
): number {
  return (
    (isTestPath(ref.file) ? 1 : 0) * 10_000_000 +
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
    case "references":
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
    // Every non-structural kind the graph stores is named above, and the
    // structural ones never reach here. `dispatches` is the only kind left, and
    // a traversal synthesizes it — no index holds one to rank.
    /* c8 ignore next 2 */
    default:
      return 10;
  }
}

function evidenceCoordinatesOf(
  evidence: ISamchonGraphEvidence | undefined,
): ISamchonGraphEvidence | undefined {
  return evidence === undefined ? undefined : publicEvidence(evidence);
}
