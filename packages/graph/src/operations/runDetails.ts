import { GraphMemory } from "../model/GraphMemory";
import { IGraphDetails } from "../structures";
import {
  bound,
  isExecution,
  isTypeEdge,
  publicEvidence,
  referencesFromEdges,
  resolveHandle,
  resultGuide,
  resultNext,
  signatureOf,
  summaryOf,
} from "./common";

const DEFAULT_NEIGHBORS = 6;
const MAX_NEIGHBORS = 16;
const DEFAULT_MEMBERS = 16;
const MAX_MEMBERS = 32;
const DEFAULT_DEPENDENCIES = 8;
const MAX_DEPENDENCIES = 20;

export function runDetails(
  graph: GraphMemory,
  props: IGraphDetails.IRequest,
): IGraphDetails {
  const neighborLimit = bound(props.neighborLimit, DEFAULT_NEIGHBORS, 1, MAX_NEIGHBORS);
  const memberLimit = bound(props.memberLimit, DEFAULT_MEMBERS, 1, MAX_MEMBERS);
  const dependencyLimit = bound(
    props.dependencyLimit,
    DEFAULT_DEPENDENCIES,
    1,
    MAX_DEPENDENCIES,
  );
  const includeExternal = props.includeExternal === true;
  const nodes: IGraphDetails.INode[] = [];
  const unknown: string[] = [];

  for (const handle of props.handles.slice(0, 6)) {
    const resolved = resolveHandle(graph, handle);
    if (resolved.node === undefined) {
      unknown.push(handle);
      continue;
    }
    const node = resolved.node;
    const detail: IGraphDetails.INode = { ...summaryOf(node) };
    const signature = signatureOf(graph.project, node);
    if (signature !== undefined) detail.signature = signature;
    if (node.decorators !== undefined && node.decorators.length > 0) {
      detail.decorators = node.decorators;
    }
    if (node.implementation !== undefined) detail.implementation = publicEvidence(node.implementation);

    const calls = referencesFromEdges(
      graph,
      graph.outgoing(node.id),
      "to",
      dependencyLimit,
      includeExternal,
      new Set(graph.outgoing(node.id).map((edge) => edge.kind).filter(isExecution)),
    );
    if (calls.length > 0) detail.calls = calls;

    const types = referencesFromEdges(
      graph,
      graph.outgoing(node.id),
      "to",
      dependencyLimit,
      includeExternal,
      new Set(graph.outgoing(node.id).map((edge) => edge.kind).filter(isTypeEdge)),
    );
    if (types.length > 0) detail.types = types;

    const members = graph
      .outgoing(node.id)
      .filter((edge) => edge.kind === "contains")
      .map((edge) => graph.node(edge.to))
      .filter((member) => member !== undefined)
      .slice(0, memberLimit)
      .map((member) => {
        const signature = signatureOf(graph.project, member);
        return {
          name: member.qualifiedName ?? member.name,
          kind: member.kind,
          ...(member.evidence?.startLine !== undefined
            ? { line: member.evidence.startLine }
            : {}),
          ...(signature !== undefined ? { signature } : {}),
        };
      });
    if (members.length > 0) detail.members = members;

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
