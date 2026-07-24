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
    from: IEndpointExpectation;
    to: IEndpointExpectation;

    /**
     * `false` asserts the relationship must NOT exist — the negative twin.
     *
     * Every positive case should have one. A provider cannot be shown to
     * resolve a call by producing calls; it is shown by producing this one and
     * not the one a text scan would also produce.
     */
    present?: boolean;
  }

  /**
   * One endpoint of a golden relationship.
   *
   * A display name alone remains concise for one-language fixtures. Atomic
   * providers can own several languages, though, so their common corpus adds
   * the language and declaration kind rather than pretending equally named
   * declarations in separate documents are interchangeable.
   */
  export type IEndpointExpectation = string | {
    name: string;
    kind: ISamchonGraphNode["kind"];
    language: ISamchonGraphNode["language"];
    file?: string;
  };

  export interface IReport {
    /** One sentence per violated expectation, in declaration order. */
    failures: string[];
  }

  /**
   * Check one published slice against a golden expectation set.
   *
   * Declarations are matched by display name and kind. Relationships identify
   * endpoints by display name, optionally qualified by kind and language,
   * because a provider's ids are its own and a harness comparing them would
   * only ever pass for the provider it was written against.
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
    // A bare endpoint must remain unique. A qualified endpoint allows one
    // atomic multi-language fixture to use the same source-level names in
    // each language without collapsing their independently proven edges.
    const nodesOf = (
      endpoint: IEndpointExpectation,
    ): readonly ISamchonGraphNode[] => {
      if (typeof endpoint === "string") {
        return [...byName.entries()]
          .filter(([key]) => key.slice(0, key.indexOf("\0")) === endpoint)
          .flatMap(([, nodes]) => nodes);
      }
      return (
        byName.get(`${endpoint.name}\0${endpoint.kind}`) ?? []
      ).filter(
        (node) =>
          node.language === endpoint.language &&
          (endpoint.file === undefined || node.file === endpoint.file),
      );
    };
    const labelOf = (endpoint: IEndpointExpectation): string =>
      typeof endpoint === "string"
        ? endpoint
        : `${endpoint.name} (${endpoint.kind}, ${endpoint.language})`;

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
        const fromNodes = nodesOf(wanted.from);
        const toNodes = nodesOf(wanted.to);
        const from = new Set(fromNodes.map((node) => node.id));
        const to = new Set(toNodes.map((node) => node.id));
        for (const [role, endpoint, nodes] of [
          ["from", wanted.from, fromNodes],
          ["to", wanted.to, toNodes],
        ] as const) {
          if (nodes.length > 1) {
            const name =
              typeof endpoint === "string" ? endpoint : endpoint.name;
            failures.push(
              `golden fixture reuses the display name "${name}" ${String(nodes.length)} times, so its ${role} edge endpoint is ambiguous`,
            );
          }
        }
        const found = snapshot.edges.some(
          (edge) =>
            edge.kind === wanted.kind &&
            from.has(edge.from) &&
            to.has(edge.to),
        );
        const shouldExist = wanted.present !== false;
        if (shouldExist && !found) {
          failures.push(
            `missing ${wanted.kind} edge ${labelOf(wanted.from)} -> ${labelOf(wanted.to)} (${expectation.reason})`,
          );
        } else if (!shouldExist && found) {
          failures.push(
            `published ${wanted.kind} edge ${labelOf(wanted.from)} -> ${labelOf(wanted.to)}, which must not exist (${expectation.reason})`,
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
    root: string = process.cwd(),
  ): IReport {
    const failures: string[] = [];
    try {
      assertGraphSnapshotContract(snapshot, provider, languages, root);
    } catch (error) {
      failures.push((error as Error).message);
    }

    const ids = new Set<string>();
    const endpoints = new Set<string>();
    for (const node of snapshot.nodes) {
      if (ids.has(node.id)) failures.push(`duplicate node id: ${node.id}`);
      ids.add(node.id);
      endpoints.add(node.id);
      if (node.file !== "") endpoints.add(node.file);
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
      // An implementation span is a second real location, encoded the same
      // way. Checking only the declaration would let a provider emit a
      // zero-based one wherever a declaration and its body are apart, which is
      // every overridden method and every header-and-source pair.
      const body = node.implementation;
      if (body !== undefined && (body.startLine < 1 || (body.startCol ?? 1) < 1)) {
        failures.push(
          `${node.id} has a zero-based implementation span at ${String(body.startLine)}:${String(body.startCol)}`,
        );
      }
    }

    for (const edge of snapshot.edges) {
      if (!endpoints.has(edge.to)) {
        failures.push(`dangling edge endpoint: ${edge.kind} -> ${edge.to}`);
      }
      if (!endpoints.has(edge.from)) {
        failures.push(`dangling edge origin: ${edge.kind} ${edge.from} ->`);
      }
    }

    const keys = new Set<string>();
    for (const edge of snapshot.edges) {
      const key = edgeKey(edge);
      if (keys.has(key)) failures.push(`duplicate edge: ${key}`);
      keys.add(key);
    }

    const provesSourceDigests = snapshot.provenance.capabilities.includes(
      "sourceDigests",
    );
    for (const [file, digest] of snapshot.sources) {
      if (provesSourceDigests && digest.checkerDigest === "") {
        failures.push(`${file} is in the manifest without a checker digest`);
      }
    }
    return { failures };
  }

  /** A slice is byte-identical to itself when nothing moved. */
  export function deterministic(
    left: IBulkGraphSession.ISnapshot,
    right: IBulkGraphSession.ISnapshot,
  ): IReport {
    const failures: string[] = [];
    if (
      graphSnapshotDigests.snapshotOf(left) !==
      graphSnapshotDigests.snapshotOf(right)
    ) {
      failures.push(
        "two indexes of the same unchanged source published different normalized snapshot bytes",
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
