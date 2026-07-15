import { ISamchonGraphEdge } from "../structures";

/**
 * One edge per `(from, to, kind)` triple, keeping the first source-order
 * evidence — which is what the wire contract on {@link ISamchonGraphEdge} says,
 * and what every consumer that breaks a tie on evidence position assumes.
 *
 * A symbol called twice in one body produces two edges with the same triple and
 * different spans. Keeping the last of them made a step read
 * `App.render -[calls at App.tsx:2093]-> renderScene` when the call the reader
 * would find first is on line 41, and it moved the tiebreak in every capped list
 * (`refRank`, `evidenceRank`) onto whichever call site happened to be written
 * last. The first one is the one a reader arrives at.
 */
export function dedupeEdges(edges: ISamchonGraphEdge[]): ISamchonGraphEdge[] {
  const map = new Map<string, ISamchonGraphEdge>();
  for (const edge of edges) {
    const key = `${edge.kind}\0${edge.from}\0${edge.to}`;
    if (!map.has(key)) map.set(key, edge);
  }
  return [...map.values()];
}
