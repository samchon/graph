import { createHash } from "node:crypto";

import { ISamchonGraphEdge, ISamchonGraphNode } from "../structures";
import { IBulkGraphSession } from "./IBulkGraphSession";

/**
 * The two digests that let a reader prove a published slice is the one a
 * provider produced, computed here rather than believed from the wire.
 *
 * A producer-reported hash proves nothing a consumer needs. It is computed by
 * the same party whose honesty is in question, over bytes only that party saw,
 * in a normalization only that party defines — so two providers' "content
 * digests" are not comparable, and neither can be recomputed by the coordinator
 * that has to decide whether a candidate is still the candidate it validated.
 * These are computed by the publisher, over the normalized facts it is about to
 * publish, in one shape shared by every provider.
 */
export namespace graphSnapshotDigests {
  /**
   * A digest over the exact input manifest the facts were computed from.
   *
   * The project transaction compares this before and after validating a
   * candidate: a manifest that moved means the candidate describes a program
   * that no longer exists, and committing it would publish facts about source
   * nobody has.
   */
  export function manifestOf(snapshot: IBulkGraphSession.ISnapshot): string {
    const hash = createHash("sha256");
    for (const file of [...snapshot.sources.keys()].sort(compareOrdinal)) {
      const digest = snapshot.sources.get(file)!;
      hash.update(`${file}\0${digest.checkerDigest}\0${digest.diskDigest}\n`);
    }
    return hash.digest("hex");
  }

  /**
   * A digest over the facts a slice publishes, in publication order.
   *
   * Order is part of the identity rather than sorted away, because the graph's
   * own contract is that an unchanged checkout produces byte-identical output:
   * a digest that hid a reordering would call two different dumps the same one.
   */
  export function contentOf(snapshot: IBulkGraphSession.ISnapshot): string {
    const hash = createHash("sha256");
    hash.update(`languages\0${snapshot.languages.join(",")}\n`);
    for (const node of snapshot.nodes) hash.update(`node\0${nodeKey(node)}\n`);
    for (const edge of snapshot.edges) hash.update(`edge\0${edgeKey(edge)}\n`);
    for (const diagnostic of snapshot.diagnostics) {
      hash.update(
        `diagnostic\0${diagnostic.file}\0${String(diagnostic.line)}\0${String(
          diagnostic.column,
        )}\0${String(diagnostic.code)}\0${diagnostic.message}\n`,
      );
    }
    return hash.digest("hex");
  }
}

function nodeKey(node: ISamchonGraphNode): string {
  return [
    node.id,
    node.kind,
    node.language,
    node.name,
    node.file,
    node.evidence?.startLine ?? "",
    node.evidence?.startCol ?? "",
    node.implementation?.startLine ?? "",
    node.implementation?.startCol ?? "",
  ].join("\0");
}

function edgeKey(edge: ISamchonGraphEdge): string {
  return [
    edge.kind,
    edge.from,
    edge.to,
    edge.evidence?.file ?? "",
    edge.evidence?.startLine ?? "",
    edge.evidence?.startCol ?? "",
  ].join("\0");
}

function compareOrdinal(left: string, right: string): number {
  /* c8 ignore next 2 -- manifest keys are distinct file identities. */
  return left < right ? -1 : left > right ? 1 : 0;
}
