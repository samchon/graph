import fs from "node:fs";
import path from "node:path";
import { SamchonGraphMemory } from "../SamchonGraphMemory";
import {
  ISamchonGraphDecorator,
  ISamchonGraphDetails,
  ISamchonGraphEvidence,
  ISamchonGraphNode,
} from "../structures";
import {
  bound,
  publicEvidence,
  referencesFromEdges,
  resolveHandle,
  resultGuide,
  resultNext,
  signatureOf,
  summaryOf,
} from "./common";

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
): ISamchonGraphDetails {
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
  for (const handle of props.handles) {
    const resolved = resolveHandle(graph, handle);
    if (resolved.node === undefined) {
      unknown.push(handle);
      continue;
    }
    const node = resolved.node;
    const detail: ISamchonGraphDetails.INode = { ...summaryOf(node) };
    if (node.evidence?.startLine !== undefined) detail.line = node.evidence.startLine;
    const sig = signatureOf(graph.project, node);
    if (sig !== undefined) detail.signature = sig;
    const signatureLiterals = literalSummaries(sig);
    const decorators = decoratorsOf(node);
    if (decorators !== undefined) detail.decorators = decorators;
    if (node.implementation !== undefined) {
      detail.implementation = publicEvidence(node.implementation);
    }
    const span = node.implementation ?? node.evidence;
    if (span !== undefined) {
      detail.sourceSpan = {
        file: span.file,
        startLine: span.startLine,
        ...(span.endLine !== undefined ? { endLine: span.endLine } : {}),
      };
    }
    const calls = referencesFromEdges(
      graph,
      graph.outgoing(node.id),
      "to",
      dependencyLimit,
      includeExternal,
      executionKinds,
    );
    if (calls.length > 0) detail.calls = calls;
    const types = referencesFromEdges(
      graph,
      graph.outgoing(node.id),
      "to",
      dependencyLimit,
      includeExternal,
      typeKinds,
    );
    if (types.length > 0) detail.types = types;
    const implementedBy = referencesFromEdges(
      graph,
      graph.incoming(node.id),
      "from",
      dependencyLimit,
      includeExternal,
      implementationKinds,
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
      detail.dependsOn = referencesFromEdges(
        graph,
        graph.outgoing(node.id),
        "to",
        neighborLimit,
        includeExternal,
      );
      detail.dependedOnBy = referencesFromEdges(
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
    type: "details",
    nodes,
    next: resultNext(
      "answer",
      "Selected signatures, members, dependencies, implementation candidates, and ranges are enough for a shape or reading-anchor answer.",
    ),
    guide: resultGuide(
      "Use signatures, members, calls, types, implementedBy, literals, and sourceSpan anchors as selected symbol facts.",
    ),
    unknown,
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

const executionKinds = new Set([
  "calls",
  "instantiates",
  "accesses",
  "renders",
]);
const typeKinds = new Set(["type_ref", "extends", "implements", "overrides"]);
const implementationKinds = new Set(["implements", "overrides"]);

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

/** Decorator facts already captured on a node, omitted when absent. */
function decoratorsOf(
  node: ISamchonGraphNode,
): ISamchonGraphDecorator[] | undefined {
  return node.decorators !== undefined && node.decorators.length > 0
    ? node.decorators
    : undefined;
}

/** Read a file's lines once, or undefined when it cannot be read. */
function fileLines(project: string, file: string): string[] | undefined {
  if (file === "") return undefined;
  try {
    return fs.readFileSync(path.join(project, file), "utf8").split(/\r?\n/);
  } catch {
    return undefined;
  }
}
