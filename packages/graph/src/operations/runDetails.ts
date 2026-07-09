import fs from "node:fs";
import path from "node:path";
import { SamchonGraphMemory } from "../SamchonGraphMemory";
import {
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

const DEFAULT_NEIGHBORS = 2;
const MAX_NEIGHBORS = 3;
const DEFAULT_MEMBERS = 6;
const MAX_MEMBERS = 8;
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
const EXECUTION_KINDS = new Set([
  "calls",
  "instantiates",
  "accesses",
  "renders",
]);
const TYPE_KINDS = new Set(["type_ref", "extends", "implements", "overrides"]);

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
  const includeExternal = props.includeExternal === true;
  const nodes: ISamchonGraphDetails.INode[] = [];
  const unknown: string[] = [];

  for (const handle of props.handles.slice(0, 6)) {
    const resolved = resolveHandle(graph, handle);
    if (resolved.node === undefined) {
      unknown.push(handle);
      continue;
    }
    const node = resolved.node;
    const detail: ISamchonGraphDetails.INode = { ...summaryOf(node) };
    const signature = signatureOf(graph.project, node);
    if (signature !== undefined) detail.signature = signature;
    if (node.decorators !== undefined && node.decorators.length > 0) {
      detail.decorators = node.decorators;
    }
    if (node.implementation !== undefined) detail.implementation = publicEvidence(
      node.implementation,
    );

    const calls = referencesFromEdges(
      graph,
      graph.outgoing(node.id),
      "to",
      dependencyLimit,
      includeExternal,
      EXECUTION_KINDS,
    );
    if (calls.length > 0) detail.calls = calls;

    const types = referencesFromEdges(
      graph,
      graph.outgoing(node.id),
      "to",
      dependencyLimit,
      includeExternal,
      TYPE_KINDS,
    );
    if (types.length > 0) detail.types = types;

    if (CONTAINER_KINDS.has(node.kind)) {
      const list = containerMembers(graph, node, memberLimit);
      if (list.length > 0) detail.members = list;
    }
    // A variable bound to an object literal has no `contains` members; parse its
    // source span for the top-level property/method outline a consumer reaches
    // for, without inlining the body.
    if (node.kind === "variable" && detail.sourceSpan !== undefined) {
      const list = objectLiteralMembers(
        graph.project,
        detail.sourceSpan,
        memberLimit,
      );
      if (list.length > 0) detail.members = list;
    }

    if (props.neighbors === true) {
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

    const diagnostics = graph.diagnosticsFor(node.file);
    if (diagnostics.length > 0) detail.diagnostics = diagnostics.slice(0, 5);
    nodes.push(detail);
  }

  return {
    type: "details",
    nodes,
    unknown,
    next: resultNext(
      "answer",
      "Selected signatures, members, dependencies, diagnostics, and spans are enough for a shape or reading-anchor answer.",
    ),
    guide: resultGuide(
      "Use signatures, members, calls, types, diagnostics, and sourceSpan anchors as selected symbol facts.",
    ),
  };
}

/** The members a container owns (via `contains`), each with its own signature. */
function containerMembers(
  graph: SamchonGraphMemory,
  node: ISamchonGraphNode,
  limit: number,
): ISamchonGraphDetails.IMember[] {
  const out: ISamchonGraphDetails.IMember[] = [];
  for (const edge of graph.outgoing(node.id)) {
    if (edge.kind !== "contains") continue;
    const member = graph.node(edge.to);
    if (member === undefined) continue;
    const signature = signatureOf(graph.project, member);
    out.push({
      name: member.qualifiedName ?? member.name,
      kind: member.kind,
      ...(member.evidence?.startLine !== undefined ? { line: member.evidence.startLine } : {}),
      ...(signature !== undefined ? { signature } : {}),
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * The top-level members of an object literal, parsed from its source span by
 * bracket depth. A member is a property (`name:`) or method (`name(`) declared
 * directly inside the outermost `{ }`.
 */
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
    // `end` is clamped to lines.length-1, so every index is in range; the `?? ""`
    // is a defensive fallback that cannot be reached.
    /* c8 ignore next */
    const raw = lines[i] ?? "";
    const text = stripStrings(raw);
    if (entered && depth === 1) {
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

function objectMemberOf(line: string, lineNumber: number): ISamchonGraphDetails.IMember | undefined {
  const text = line.trim();
  if (text === "" || text.startsWith("//") || text.startsWith("/*") || text.startsWith("*")) {
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
  const method = /^(?:async\s+)?(?:get\s+|set\s+)?([A-Za-z_$][\w$-]*)\s*\(/.exec(
    text,
  );
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

/** Read a file's lines once, or undefined when it cannot be read. */
function fileLines(project: string, file: string): string[] | undefined {
  if (file === "") return undefined;
  try {
    return fs.readFileSync(path.join(project, file), "utf8").split(/\r?\n/);
  } catch {
    return undefined;
  }
}
