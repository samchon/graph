import { isDeepStrictEqual } from "node:util";

import {
  isSemanticGraphNodeId,
  validateSemanticGraphNode,
} from "../provider/semanticIdentity";
import { ISamchonGraphEvidence, ISamchonGraphNode } from "../structures";

/**
 * Remove identical generic facts and merge the two locations of one semantic
 * declaration. A differing legacy collision is an indexing defect, never a
 * last-write-wins choice.
 */
export function dedupeNodes(nodes: ISamchonGraphNode[]): ISamchonGraphNode[] {
  const map = new Map<string, ISamchonGraphNode>();
  for (const node of nodes) {
    validateSemanticGraphNode(node);
    const previous = map.get(node.id);
    if (previous === undefined) {
      map.set(node.id, node);
      continue;
    }
    map.set(node.id, mergeDuplicate(previous, node));
  }
  return [...map.values()];
}

/**
 * Merge only intrinsic semantic duplicates in a strict provider slice.
 * Legacy duplicates remain visible for the strict trust boundary to reject.
 */
export function mergeSemanticNodes(
  nodes: readonly ISamchonGraphNode[],
): ISamchonGraphNode[] {
  const semantic = new Map<string, number>();
  const out: ISamchonGraphNode[] = [];
  for (const node of nodes) {
    validateSemanticGraphNode(node);
    if (!isSemanticGraphNodeId(node.id)) {
      out.push(node);
      continue;
    }
    const index = semantic.get(node.id);
    if (index === undefined) {
      semantic.set(node.id, out.length);
      out.push(node);
    } else {
      out[index] = mergeDuplicate(out[index]!, node);
    }
  }
  return out;
}

function mergeDuplicate(
  left: ISamchonGraphNode,
  right: ISamchonGraphNode,
): ISamchonGraphNode {
  if (!isSemanticGraphNodeId(left.id)) {
    if (isDeepStrictEqual(left, right)) return left;
    // Two distinct declarations share a legacy id — same-named locals a
    // generic/static producer cannot tell apart without a native symbol, and a
    // TypeScript id must stay `path#qualifiedName:kind` for parity so it cannot
    // be promoted here. The strict provider boundary still rejects such a
    // collision; the generic path keeps the last declaration, exactly as the
    // pre-identity dedupe did, rather than failing the whole graph.
    return right;
  }
  const leftFact = factWithoutLocations(left);
  const rightFact = factWithoutLocations(right);
  if (!isDeepStrictEqual(leftFact, rightFact)) {
    throw new Error(
      `@samchon/graph: semantic node locations disagree on symbol facts: ${left.id}`,
    );
  }
  const locations = uniqueLocations([
    left.evidence,
    left.implementation,
    right.evidence,
    right.implementation,
  ]);
  if (locations.length > 2) {
    throw new Error(
      `@samchon/graph: semantic node has more than the declaration/implementation location policy can preserve: ${left.id}`,
    );
  }
  const [evidence, implementation] = locations;
  return {
    ...leftFact,
    file: evidence?.file ?? left.file,
    ...(left.ignored === true || right.ignored === true
      ? { ignored: true }
      : {}),
    ...(left.exported === true || right.exported === true
      ? { exported: true }
      : {}),
    ...(left.closure === true || right.closure === true
      ? { closure: true }
      : {}),
    ...(evidence === undefined ? {} : { evidence }),
    ...(implementation === undefined ? {} : { implementation }),
  };
}

function factWithoutLocations(
  node: ISamchonGraphNode,
): ISamchonGraphNode {
  const {
    evidence: _evidence,
    implementation: _implementation,
    file: _file,
    ignored: _ignored,
    exported: _exported,
    closure: _closure,
    ...fact
  } = node;
  return { ...fact, file: "" };
}

function uniqueLocations(
  values: readonly (ISamchonGraphEvidence | undefined)[],
): ISamchonGraphEvidence[] {
  const map = new Map<string, ISamchonGraphEvidence>();
  for (const value of values) {
    if (value === undefined) continue;
    map.set(locationKey(value), value);
  }
  return [...map.values()].sort((left, right) =>
    compareText(locationKey(left), locationKey(right)),
  );
}

function locationKey(evidence: ISamchonGraphEvidence): string {
  return [
    evidence.file,
    evidence.startLine,
    evidence.startCol ?? 0,
    evidence.endLine ?? 0,
    evidence.endCol ?? 0,
  ].join("\0");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
