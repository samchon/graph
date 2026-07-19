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
import { isExternalNode } from "./isExternalNode";
import { isStructural } from "./isStructural";
import { isTestPath } from "./isTestPath";
import { publicEvidence } from "./publicEvidence";
import { resolveGraphHandle } from "./resolveGraphHandle";
import { IRunnerOutput } from "./IRunnerOutput";
import { resultNext } from "./resultNext";
import { signatureOf } from "./signatureOf";

// A symbol's fan-out — what it calls, what names it in a type, what depends on
// it — scales with how popular it is, not with the symbol: a central type is
// named in a thousand places, and returning all of them is a "who uses this"
// trace/impact question, not "what is this". So fan-out is a small default
// slice; identity (members, literals) is not, because a class's members and a
// union's values are the symbol itself and are bounded by the declaration.
const DEFAULT_NEIGHBORS = 2;
const MAX_NEIGHBORS = 3;
const DEFAULT_DEPENDENCIES = 2;
const MAX_DEPENDENCIES = 4;
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
  // Identity is the whole answer. The caller named this handle to learn what it
  // is, and a class's members or a union's values are the symbol itself — cut
  // them and the model reads the file for the rest, the read this index exists
  // to remove. So `memberLimit` (and `literals`) default to unlimited. Fan-out
  // does not: what names or uses a symbol is bounded by its popularity, not by
  // it, so those stay a small slice with `trace` for the rest.
  const memberLimit = limitOf(props.memberLimit);
  const neighborLimit = bound(
    props.neighborLimit,
    DEFAULT_NEIGHBORS,
    1,
    MAX_NEIGHBORS,
  );
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
    const sig = signatureOf(graph, node);
    if (sig !== undefined) detail.signature = sig;
    const doc = docOf(graph, node);
    if (doc !== undefined) detail.doc = doc;
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
    if (node.kind === "variable") {
      const list = objectLiteralMembers(node, memberLimit);
      if (list.length > 0) detail.members = list;
    }
    if (node.kind === "enum") {
      const list = enumMembers(node, memberLimit);
      if (list.length > 0) detail.members = list;
    }
    if (node.literals !== undefined && node.literals.length > 0) {
      detail.literals = node.literals;
    }
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
    const sig = signatureOf(graph, member);
    if (sig !== undefined) m.signature = sig;
    const decorators = decoratorsOf(member);
    if (decorators !== undefined) m.decorators = decorators;
    out.push(m);
    if (out.length >= limit) break;
  }
  return out;
}

function objectLiteralMembers(
  node: ISamchonGraphNode,
  limit: number,
): ISamchonGraphDetails.IMember[] {
  return (node.objectMembers ?? []).slice(0, limit).map((member) => ({
    name: member.name,
    kind: member.kind,
    ...(member.line !== undefined ? { line: member.line } : {}),
    ...(member.signature !== undefined
      ? { signature: member.signature }
      : {}),
  }));
}

function enumMembers(
  node: ISamchonGraphNode,
  limit: number,
): ISamchonGraphDetails.IMember[] {
  return (node.enumMembers ?? []).slice(0, limit).map((member) => ({
    name: `${node.qualifiedName ?? node.name}.${member.name}`,
    kind: "property",
    ...(member.value !== undefined
      ? { signature: `${member.name} = ${member.value}` }
      : {}),
  }));
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

/**
 * An identity list's cap: none by default, honored when a caller passes one.
 *
 * `details` answers a named handle's own shape in full — its members, its
 * values — so the default is unlimited; the tour passes an explicit number to
 * embed a compact slice of its own. Fan-out lists keep the small capped default
 * that `bound` gives them instead, because what uses a symbol grows with its
 * popularity, not with the symbol.
 */
function limitOf(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value)
    ? Infinity
    : Math.max(1, Math.floor(value));
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
