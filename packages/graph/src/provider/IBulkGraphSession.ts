import {
  ISamchonGraphDiagnostic,
  ISamchonGraphEdge,
  ISamchonGraphNode,
} from "../structures";
import { GraphLanguage } from "../typings";

/**
 * One compiler-owned whole-graph session.
 *
 * Unlike an editor LSP session, a bulk session publishes one complete language
 * slice at a time. A changed slice is therefore safe to swap only after its
 * entire response has been parsed and validated; an unchanged response reuses
 * the last snapshot and generation verbatim.
 */
export interface IBulkGraphSession {
  readonly kind: "bulk";
  readonly language: GraphLanguage;
  readonly root: string;
  readonly generation: number;
  readonly current: IBulkGraphSession.ISnapshot | undefined;

  refresh(): Promise<IBulkGraphSession.IRefresh>;
  close(): Promise<void>;
}

export namespace IBulkGraphSession {
  /** A complete strict fact slice from one compiler snapshot. */
  export interface ISnapshot {
    language: GraphLanguage;
    nodes: ISamchonGraphNode[];
    edges: ISamchonGraphEdge[];

    /**
     * What the compiler said about the same generation that produced the facts.
     *
     * Empty means the producer reported none — not that none were collected.
     * Only {@link IProvenance.capabilities} distinguishes those, which is why
     * it is not enough to hand back the list and let a reader draw conclusions
     * from its length.
     */
    diagnostics: ISamchonGraphDiagnostic[];

    /**
     * The manifest of files this snapshot's facts were computed from, keyed by
     * absolute path.
     *
     * This used to be the files' text, read off the disk by the client after
     * the compiler had answered. That is what a bulk provider must not do: the
     * bytes a later read returns are not the bytes the checker resolved
     * against, and no amount of asking the server again closes the gap — a
     * write that lands and reverts in between is invisible to both questions.
     * The producer is the only party that can state this, so it states it, and
     * the graph never ships the text at all. A digest is the opposite of
     * inlining a body: it is what lets a reader prove byte-identity against
     * text it read itself, without this package ever carrying that text.
     */
    sources: Map<string, ISourceDigest>;

    /** Which program produced everything above, and what it can prove. */
    provenance: IProvenance;

    warnings: string[];
  }

  /**
   * The manifest entry for one file in the snapshot's program.
   *
   * Two digests, because "the bytes the checker read" and "the bytes on disk"
   * are not always the same string, and a reader needs to know which one it is
   * comparing against. A TypeScript source-preamble plugin injects text ahead
   * of a file before it is parsed, and then a reader that opens the file gets
   * something the checker never saw. Conflating the two would silently pick one
   * meaning and be wrong under exactly that plugin.
   */
  export interface ISourceDigest {
    /**
     * Hex-encoded SHA-256 of the text the checker resolved against — the ground
     * truth for the facts. Every node, edge, and span attributed to this file
     * was computed from these bytes.
     */
    checkerDigest: string;

    /**
     * Hex-encoded SHA-256 of the file's on-disk bytes at snapshot time, or `""`
     * when the producer could not read it or it has no on-disk identity.
     *
     * This is the one a reader that opens the file itself can reproduce. When
     * it equals {@link checkerDigest}, a matching read proves byte-identity
     * with the facts; when it does not, the checker saw augmented text and that
     * proof is simply unavailable for this file — a thing to report rather than
     * paper over. Read it only when {@link IProvenance.capabilities} claims
     * `diskDigests`; without that claim every entry is `""` because the
     * producer never hashed the disk, which is a different fact from a file it
     * could not read.
     */
    diskDigest: string;
  }

  /**
   * What a snapshot knows about its own origin, in terms every bulk provider
   * can answer — not just `ttscgraph`.
   *
   * A bulk provider's claim is that its nodes, edges, spans, and diagnostics
   * all came from one program. That claim is only worth anything if the
   * response carries the evidence for it; otherwise a consumer can do nothing
   * but re-read the disk afterwards and hope, which is the unsound
   * reconstruction this contract exists to make unnecessary.
   */
  export interface IProvenance {
    /** The producing tool's name, such as `ttscgraph`. */
    tool: string;

    /**
     * The producing tool's build version, or `""` when it carries none.
     *
     * Separate from {@link tool} because a consumer that parses a version must
     * not be handed a tool name, and separate from {@link compilerVersion}
     * because the tool and the checker it embeds do not share a version line.
     */
    toolVersion: string;

    /** The language version the producer's checker implements. */
    compilerVersion: string;

    /** The wire protocol version the producer spoke. */
    protocolVersion: number;

    /**
     * A fingerprint of the inputs that decide which files are in the program at
     * all — for TypeScript, the tsconfig chain and the resolved root set.
     *
     * It is a digest rather than the inputs themselves because the only
     * question a consumer asks of it is whether it is the same one as last
     * time, and because every language's answer to "what decides the file set"
     * has a different shape. A change to it can add or drop whole files, so
     * facts must never be carried across a snapshot whose fingerprint moved.
     */
    universe: string;

    /**
     * What this snapshot proves, as the producer names it.
     *
     * A consumer degrades against this rather than guessing from a field's
     * emptiness, because an empty list and an uncollected one look identical on
     * the wire. Stays `string[]` rather than a union: a producer that proves
     * something this client has not heard of must not be rejected for it.
     */
    capabilities: string[];
  }

  /** Result of polling a resident compiler session. */
  export interface IRefresh {
    changed: boolean;
    generation: number;

    /**
     * What the producer did, as the producer reported it.
     *
     * Never inferred. A generation counter cannot tell a reuse from a full
     * rebuild after the fact — both move it by one — so anything derived from
     * generations here would be a guess wearing a fact's clothes.
     */
    mode: Mode;

    snapshot: ISnapshot;
  }

  /**
   * What a bulk producer did to answer one refresh.
   *
   * - `initial`: the session's first snapshot.
   * - `reload`: the build universe moved, so the program was reloaded whole.
   * - `unchanged`: nothing moved; the previous snapshot still holds.
   * - `incremental`: edits applied onto the reused resident program.
   * - `rebuild`: edits applied, but the program could not be reused.
   *
   * There is no `error` member, though the `ttscgraph` wire has one. A failed
   * refresh rejects; it does not resolve to an {@link IRefresh} carrying a
   * snapshot that does not exist. The wire needs the extra literal because a
   * frame must describe itself even when it failed — a caller that cannot parse
   * the rest still learns why — but that is a transport state, and admitting it
   * here would oblige every reader of {@link IRefresh.snapshot} to first ask
   * whether the refresh happened at all.
   */
  export type Mode =
    | "initial"
    | "reload"
    | "unchanged"
    | "incremental"
    | "rebuild";
}
