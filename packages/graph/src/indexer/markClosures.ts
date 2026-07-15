import { ISamchonGraphNode } from "../structures";

/** Declarations whose body can hold another declaration: a closure's parent. */
const BODY_KINDS = new Set<string>(["function", "method", "constructor"]);

/**
 * Flag every declaration made inside another declaration's body.
 *
 * `@ttsc/graph` has a checker and asks it directly; without one the fact is a
 * range comparison, and the indexers already record the containment that makes
 * it: a nested declaration's `qualifiedName` is its owner's path plus its own
 * name, in both the static parser (the owner stack) and the language-server
 * pass (the document-symbol hierarchy). So a node is a closure when any owner
 * on that path is a function, a method, or a constructor — which is exactly
 * "its declaration range sits inside another function's range", read off the
 * hierarchy instead of re-derived from spans.
 *
 * The flag is what keeps a tour on the project's surface: a closure stays in
 * the index, so `trace`, `lookup`, and `details` still answer with one, but the
 * tour does not rank it, walk it, or count its edges (see `isTourSeed`).
 */
export function markClosures(nodes: readonly ISamchonGraphNode[]): void {
  const byPath = new Map<string, ISamchonGraphNode>();
  for (const node of nodes) {
    byPath.set(`${node.file}\0${node.qualifiedName ?? node.name}`, node);
  }
  for (const node of nodes) {
    if (node.qualifiedName === undefined) continue;
    let owner = ownerPath(node.qualifiedName);
    while (owner !== undefined) {
      const parent = byPath.get(`${node.file}\0${owner}`);
      if (parent !== undefined && BODY_KINDS.has(parent.kind)) {
        node.closure = true;
        break;
      }
      owner = ownerPath(owner);
    }
  }
}

/** `A.b.c` -> `A.b`, and `A` -> undefined. */
function ownerPath(qualifiedName: string): string | undefined {
  const dot = qualifiedName.lastIndexOf(".");
  return dot < 0 ? undefined : qualifiedName.slice(0, dot);
}
