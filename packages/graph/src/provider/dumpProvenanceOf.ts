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
