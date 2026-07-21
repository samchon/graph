import { compareOrdinal } from "@samchon/graph-sitter";

import { ISamchonGraphDump } from "../structures";
import { graphSnapshotDigests } from "./graphSnapshotDigests";
import { IBulkGraphSession } from "./IBulkGraphSession";

/**
 * The provenance row one strict slice publishes in the dump.
 *
 * The session's own provenance is the producer's statement about itself; this
 * is what the graph is prepared to publish about it, which is a smaller thing.
 * The manifest and content digests are recomputed here rather than copied from
 * the wire, because a digest supplied by the party whose output it describes
 * proves nothing to the party that has to decide whether the slice it holds is
 * still the slice it validated.
 */
export function dumpProvenanceOf(
  snapshot: IBulkGraphSession.ISnapshot,
): ISamchonGraphDump.IProvenance {
  const provenance = snapshot.provenance;
  return {
    provider: provenance.provider,
    languages: [...snapshot.languages],
    authority: provenance.authority,
    facts: [...provenance.facts],
    capabilities: [...provenance.capabilities],
    producer: {
      tool: provenance.tool,
      version: provenance.toolVersion,
      compiler: provenance.compilerVersion,
      schemaVersion: provenance.schemaVersion,
      protocolVersion: provenance.protocolVersion,
    },
    universe: provenance.universe,
    manifest: graphSnapshotDigests.manifestOf(snapshot),
    content: graphSnapshotDigests.contentOf(snapshot),
  };
}

export namespace dumpProvenanceOf {
  /**
   * The dump's whole `provenance` field for one build's rows, or nothing.
   *
   * Sorted by provider name rather than left in selection order, so the dump
   * stays a pure function of its source: registry order is a property of the
   * build, not of the code it describes, and a reordering there must not change
   * the bytes of a dump taken from an unedited checkout.
   *
   * Omitted entirely when empty, because an empty array would claim a provider
   * was asked and proved nothing.
   *
   * Both publishers call this rather than each deciding the rule again. A
   * one-shot build and a resident refresh disagreeing about ordering or about
   * what an empty set means would make one checkout publish two different
   * dumps, which is the one property this structure's contract rests on.
   */
  export function fieldOf(
    rows: readonly ISamchonGraphDump.IProvenance[],
  ): { provenance?: ISamchonGraphDump.IProvenance[] } {
    if (rows.length === 0) return {};
    return {
      provenance: [...rows].sort((left, right) =>
        compareOrdinal(left.provider, right.provider),
      ),
    };
  }
}
