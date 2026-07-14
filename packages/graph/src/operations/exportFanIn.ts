import { SamchonGraphMemory } from "../SamchonGraphMemory";

/**
 * How public a symbol is, counted from the graph and nothing else.
 *
 * A module's `exports` edges are the project's export table, resolved through
 * every re-export and barrel it passes. So a symbol carries one edge per module
 * that puts it on the wire, and that count is the project's own answer to how
 * far forward the symbol stands: an internal helper is exported by the file
 * that declares it or by nothing at all, while the name a consumer imports from
 * the package has been re-exported up a chain of barrels and carries an edge
 * from each one.
 *
 * On a library that still ships a previous major, the count is the whole
 * difference between the current API and the legacy one: the classic surface's
 * `parse` carries an edge from every barrel above it, the previous major's
 * class carries fewer, and that major's own method — which no export table ever
 * names — carries none. A ranker that knew only the `exported` flag saw all of
 * these as equally public, picked the one whose name matched the question best,
 * and opened the tour on the legacy implementation.
 *
 * The count is a fact the indexer resolved. It reads no package.json, guesses
 * from no filename, and holds for a project that has neither.
 */
export function exportFanIn(graph: SamchonGraphMemory, id: string): number {
  let count = 0;
  for (const edge of graph.incoming(id)) if (edge.kind === "exports") count++;
  return count;
}
