/**
 * One response frame of the `ttscgraph serve` protocol, as this client pins it.
 *
 * Mirrored by hand from `serveResponse` in ttsc's
 * `packages/ttsc/cmd/ttscgraph/serve.go`, first published at tag `v0.19.2`
 * (`77192d97a`). There is no generator between the Go struct and this file, and
 * there cannot be one this repository owns: the producer lives in another
 * repository and ships as a prebuilt binary whose version the target project —
 * not this package — chooses. That is why {@link ITtscGraphSnapshot.PROTOCOL_VERSION}
 * exists, and why {@link parseTtscGraphSnapshot} validates every field on
 * arrival instead of casting.
 *
 * This is the envelope only. The `dump` it carries stays `unknown` here on
 * purpose: {@link adaptTtscGraphDump} validates the body field by field into
 * the product's own structures, so restating the body's wire shape would add a
 * second contract to keep in sync with the same Go struct — and it would be the
 * one the adapter never consults, which is the kind of duplicate that goes
 * stale without anything failing.
 */
export type ITtscGraphSnapshot =
  | ITtscGraphSnapshot.IFailure
  | ITtscGraphSnapshot.IResult;

export namespace ITtscGraphSnapshot {
  /** What every frame owes its caller, whatever became of the request. */
  export interface IBase {
    /** Echoes the request's id, so a response finds its caller. */
    id: number;

    /**
     * The protocol version the producer speaks.
     *
     * It rides every frame rather than a handshake, error frames included. The
     * binary and this package version independently — {@link
     * resolveTtscGraphCommand} runs whichever `ttscgraph` the target project
     * installed, or whatever `TTSC_GRAPH_BINARY` points at — so a mismatched
     * pair is reachable, and before this field existed nothing detected it: the
     * first symptom was a misparsed dump or a silently absent value.
     */
    protocolVersion: number;

    /** What this producer claims it can prove about the snapshots it publishes. */
    capabilities: string[];
  }

  /**
   * A request that produced no snapshot.
   *
   * `mode` and `error` are correlated here rather than left as two independent
   * optional fields, so that a reader who has ruled out failure has also ruled
   * out `"error"` as a mode — and cannot be asked to map a transport state onto
   * a computation one. {@link parseTtscGraphSnapshot} refuses any frame where
   * the two disagree, which is what earns this type.
   */
  export interface IFailure extends IBase {
    mode: "error";
    error: string;
    changed: false;
    dump?: undefined;
  }

  /** A request the producer answered, whether or not the graph moved. */
  export interface IResult extends IBase {
    /**
     * What the producer did to answer this request.
     *
     * Required, and never absent. The producer is the only party that can know
     * it: a generation counter moves by one for a reuse and for a full rebuild
     * alike, so nothing downstream can recover the distinction after the fact.
     */
    mode: ComputationMode;

    error?: undefined;

    /** Whether the graph moved since the last snapshot. */
    changed: boolean;

    /** The snapshot body, present exactly when `changed` is true. */
    dump?: unknown;
  }
  /**
   * The serve protocol version this client speaks.
   *
   * Equal to `serveProtocolVersion` in
   * `packages/ttsc/cmd/ttscgraph/serve.go`. A producer below it is rejected
   * with a precise error rather than parsed: a v0 frame carried no manifest, no
   * universe, and no diagnostics, so it cannot answer the questions this client
   * now asks of it, and reading one would mean guessing at exactly the evidence
   * the pin exists to establish.
   *
   * A producer at or above it is accepted. That is a deliberate divergence from
   * `@ttsc/graph`'s own session, which demands exact equality on the grounds
   * that a server on another version is entitled to another shape. The grounds
   * are sound; the conclusion does not transfer, because the two clients do not
   * read the wire the same way. `@ttsc/graph` asserts the whole envelope
   * against one fixed shape, so a v2 that merely added a field fails its assert
   * indistinguishably from a v2 that redefined one — it must reject both. This
   * client validates only the fields it reads, one at a time, and every read
   * that cannot be satisfied throws naming the field it failed on. So an
   * additive v2 keeps working, which matters because the binary's version is
   * the target project's choice and exact equality would break every consumer
   * on the day ttsc adds a field; and an incompatible v2 fails on the field it
   * broke, by name — the same diagnosis a version mismatch would have given,
   * and never a silent misread.
   */
  export const PROTOCOL_VERSION = 1;

  /**
   * What the compiler did, as opposed to what the transport did.
   *
   * - `initial`: the session's first snapshot.
   * - `reload`: the build universe moved, so the program was reloaded whole.
   * - `unchanged`: nothing moved; no dump rides it and the last one still holds.
   * - `incremental`: edits applied onto the reused resident program.
   * - `rebuild`: edits applied, but the program could not be reused.
   *
   * These are exactly {@link IBulkGraphSession.Mode}, and the provider assigns
   * one to the other without a mapping table. That is not an accident to be
   * tidied away behind a converter: the two vocabularies are separately owned —
   * one by a Go constant block, one by this product's provider contract — and
   * writing the identity as a plain assignment makes the type checker the thing
   * that notices if they ever stop agreeing. A converter with a `default` case
   * would silently absorb the same drift.
   */
  export type ComputationMode =
    | "initial"
    | "reload"
    | "unchanged"
    | "incremental"
    | "rebuild";

  /**
   * The computation modes, plus the transport's `error`.
   *
   * `error` is not a computation mode. It exists so that `mode` is never absent
   * — the producer's `omitempty` used to drop it on exactly the path a consumer
   * most needed it — and a frame carrying it produced no snapshot at all.
   */
  export type Mode = ComputationMode | "error";

  /** Every {@link Mode} the wire may carry, for validating one. */
  export const MODES: readonly Mode[] = [
    "initial",
    "reload",
    "unchanged",
    "incremental",
    "rebuild",
    "error",
  ];

  /**
   * The capability names this client reads.
   *
   * A producer may name others, and an unknown name is ignored rather than
   * rejected — "proves more than you have heard of" is precisely the case a
   * consumer should shrug at. What a consumer must not do is infer a capability
   * from a field's emptiness: an empty diagnostics list and an uncollected one
   * are the same bytes on the wire, and only this list tells them apart.
   */
  export const CAPABILITY_UNIVERSE = "universe";
  export const CAPABILITY_SOURCE_DIGESTS = "sourceDigests";
  export const CAPABILITY_DISK_DIGESTS = "diskDigests";
  export const CAPABILITY_DIAGNOSTICS = "diagnostics";
}
