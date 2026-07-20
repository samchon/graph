import {
  assertGraphSnapshotContract,
  graphSnapshotDigests,
  type GraphEdgeKind,
  type IBulkGraphSession,
  type IGraphProvider,
  type ISamchonGraphEdge,
  type ISamchonGraphNode,
} from "@samchon/graph";

/**
 * The strict semantic conformance kit every provider must pass.
 *
 * The experiment catalog it replaces proved that a server started and returned
 * some nodes. Eight languages were allowed zero edges; the rest could pass on
 * one. A provider that emitted a node per identifier it saw and no edges at all
 * would have passed nine of sixteen lanes, and a provider that guessed edges
 * from punctuation would have passed all of them — which is the failure this
 * kit exists to make impossible.
 *
 * So conformance is stated as golden assertions about named symbols, each with
 * a negative twin one property away. The twin is the whole point: "there is a
 * `calls` edge from `caller` to `callee`" is satisfied by a provider that emits
 * a `calls` edge between every pair of names in a file. "…and there is none
 * from `caller` to `mentionedInAComment`" is not.
 */
export namespace Conformance {
  /** One fact a conforming provider must publish, or must not. */
  export interface IExpectation {
    /** Why this case exists, quoted in the failure. */
    reason: string;

    /** A declaration the provider must publish, identified by name and kind. */
    node?: INodeExpectation;

    /** A relationship the provider must publish, or must not. */
    edge?: IEdgeExpectation;
  }

  export interface INodeExpectation {
    name: string;
    kind: ISamchonGraphNode["kind"];
    language: ISamchonGraphNode["language"];
    file?: string;

    /** `false` asserts the declaration must NOT exist. */
    present?: boolean;
  }

  export interface IEdgeExpectation {
    kind: GraphEdgeKind;
    from: string;
    to: string;

    /**
     * `false` asserts the relationship must NOT exist — the negative twin.
     *
     * Every positive case should have one. A provider cannot be shown to
     * resolve a call by producing calls; it is shown by producing this one and
     * not the one a text scan would also produce.
     */
    present?: boolean;
  }

  export interface IReport {
    /** One sentence per violated expectation, in declaration order. */
    failures: string[];
  }

  /**
   * Check one published slice against a golden expectation set.
   *
   * Symbols are matched by display name and kind rather than by id, because a
   * provider's ids are its own — that is the point of a semantic identity —
   * and a harness that compared them would only ever pass for the provider it
   * was written against.
   */
  export function check(
    snapshot: IBulkGraphSession.ISnapshot,
    expectations: readonly IExpectation[],
  ): IReport {
    const failures: string[] = [];
    const byName = new Map<string, ISamchonGraphNode[]>();
    for (const node of snapshot.nodes) {
      const key = `${node.name}\0${node.kind}`;
      byName.set(key, [...(byName.get(key) ?? []), node]);
    }
    const idsOf = (name: string): Set<string> => {
      const ids = new Set<string>();
      for (const [key, nodes] of byName) {
        if (key.slice(0, key.indexOf("\0")) !== name) continue;
        for (const node of nodes) ids.add(node.id);
      }
      return ids;
    };

    for (const expectation of expectations) {
      if (expectation.node !== undefined) {
        const wanted = expectation.node;
        const found = (byName.get(`${wanted.name}\0${wanted.kind}`) ?? []).filter(
          (node) =>
            node.language === wanted.language &&
            (wanted.file === undefined || node.file === wanted.file),
        );
        const shouldExist = wanted.present !== false;
        if (shouldExist && found.length === 0) {
          failures.push(
            `missing ${wanted.kind} "${wanted.name}" (${expectation.reason})`,
          );
        } else if (!shouldExist && found.length > 0) {
          failures.push(
            `published ${wanted.kind} "${wanted.name}", which must not exist (${expectation.reason})`,
          );
        }
      }
      if (expectation.edge !== undefined) {
        const wanted = expectation.edge;
        const from = idsOf(wanted.from);
        const to = idsOf(wanted.to);
        const found = snapshot.edges.some(
          (edge) =>
            edge.kind === wanted.kind &&
            from.has(edge.from) &&
            to.has(edge.to),
        );
        const shouldExist = wanted.present !== false;
        if (shouldExist && !found) {
          failures.push(
            `missing ${wanted.kind} edge ${wanted.from} -> ${wanted.to} (${expectation.reason})`,
          );
        } else if (!shouldExist && found) {
          failures.push(
            `published ${wanted.kind} edge ${wanted.from} -> ${wanted.to}, which must not exist (${expectation.reason})`,
          );
        }
      }
    }
    return { failures };
  }

  /**
   * The structural invariants every snapshot must satisfy, whatever it
   * indexed.
   *
   * These are separate from the golden facts because they are not about a
   * language at all. A dangling endpoint, a duplicated id, a zero-based span,
   * or a non-deterministic order is wrong for every provider, and a language
   * fixture that happened not to contain the shape would never catch it.
   */
  export function structure(
    snapshot: IBulkGraphSession.ISnapshot,
    provider: IGraphProvider,
    languages: readonly ISamchonGraphNode["language"][],
  ): IReport {
    const failures: string[] = [];
    try {
      assertGraphSnapshotContract(snapshot, provider, languages);
    } catch (error) {
      failures.push((error as Error).message);
    }

    const ids = new Set<string>();
    for (const node of snapshot.nodes) {
      if (ids.has(node.id)) failures.push(`duplicate node id: ${node.id}`);
      ids.add(node.id);
      const span = node.evidence;
      if (span === undefined) continue;
      // One-based, always. A zero encoded here reads as line 0, which no
      // editor can open and no reader can tell from "unknown".
      if (span.startLine < 1 || (span.startCol ?? 1) < 1) {
        failures.push(
          `${node.id} has a zero-based span at ${String(span.startLine)}:${String(span.startCol)}`,
        );
      }
      if ((span.endLine ?? span.startLine) < span.startLine) {
        failures.push(`${node.id} has a span that ends before it starts`);
      }
    }

    for (const edge of snapshot.edges) {
      if (!ids.has(edge.to)) {
        failures.push(`dangling edge endpoint: ${edge.kind} -> ${edge.to}`);
      }
      if (!ids.has(edge.from)) {
        failures.push(`dangling edge origin: ${edge.kind} ${edge.from} ->`);
      }
    }

    const keys = new Set<string>();
    for (const edge of snapshot.edges) {
      const key = edgeKey(edge);
      if (keys.has(key)) failures.push(`duplicate edge: ${key}`);
      keys.add(key);
    }

    for (const [file, digest] of snapshot.sources) {
      if (digest.checkerDigest === "") {
        failures.push(`${file} is in the manifest without a checker digest`);
      }
    }
    return { failures };
  }

  /**
   * A slice is byte-identical to itself when nothing moved.
   *
   * Compared through the published digest rather than by deep equality,
   * because the digest is what the dump and the transaction fence actually
   * compare; an equality helper could agree while the digest disagreed.
   */
  export function deterministic(
    left: IBulkGraphSession.ISnapshot,
    right: IBulkGraphSession.ISnapshot,
  ): IReport {
    const failures: string[] = [];
    if (
      graphSnapshotDigests.contentOf(left) !==
      graphSnapshotDigests.contentOf(right)
    ) {
      failures.push(
        "two indexes of the same unchanged source published different content digests",
      );
    }
    if (
      graphSnapshotDigests.manifestOf(left) !==
      graphSnapshotDigests.manifestOf(right)
    ) {
      failures.push(
        "two indexes of the same unchanged source published different manifest digests",
      );
    }
    return { failures };
  }

  /** Every failure across a set of reports, flattened for one assertion. */
  export function failures(...reports: readonly IReport[]): string[] {
    return reports.flatMap((report) => report.failures);
  }
}

function edgeKey(edge: ISamchonGraphEdge): string {
  return `${edge.kind}\0${edge.from}\0${edge.to}\0${edge.evidence?.startLine ?? ""}\0${edge.evidence?.startCol ?? ""}`;
}
