import { GraphEdgeKind } from "../typings/GraphEdgeKind";
import { GraphLanguage } from "../typings/GraphLanguage";
import { GraphProviderAuthority } from "../typings/GraphProviderAuthority";
import { ISamchonGraphDiagnostic } from "./ISamchonGraphDiagnostic";
import { ISamchonGraphEdge } from "./ISamchonGraphEdge";
import { ISamchonGraphNode } from "./ISamchonGraphNode";
import { ISamchonGraphSpan } from "./ISamchonGraphSpan";

/**
 * The whole-graph export `samchon-graph dump` writes and the MCP server loads —
 * the wire contract between the indexer and the code graph engine.
 *
 * It is the complete graph with none of the per-response caps the MCP tools
 * apply: every node and edge the build resolved. The server parses each changed
 * snapshot (typia-validated) into an in-memory resident graph and reuses that
 * warm model while project inputs stay unchanged.
 *
 * It is a pure function of its source: two dumps of the same unedited checkout
 * are byte-identical, so a graph can be cached, diffed, and trusted. Nothing
 * here records when it was built — a timestamp would move under an unchanged
 * source, which is exactly the property a cache and a diff depend on.
 *
 * `project` is absolute. A graph file identity uses normalized forward slashes:
 * a project-owned file is relative to `project`, a compiler-loaded file outside
 * that root keeps its normalized absolute identity, and a virtual compiler
 * library keeps its `bundled:///` identity. The same identity flows through a
 * node's `file`, legacy id prefix when it has one, reconstructed edge evidence,
 * diagnostics, and operation results.
 */
export interface ISamchonGraphDump {
  /** Absolute path of the project root the graph was built for. */
  project: string;

  /** The source languages present in this dump. */
  languages: GraphLanguage[];

  /** Which indexing strategy produced the graph. */
  indexer: "lsp" | "static" | "hybrid";

  /**
   * What each strict provider proved about the slice it contributed.
   *
   * One row per contributing provider, ordered by provider name so an
   * unchanged checkout produces byte-identical output. Absent when no strict
   * provider served this build, and absent from dumps written before this
   * field existed — a reader must treat its absence as "no provider stated
   * this", never as "no provider contributed".
   *
   * Only strict providers appear. The generic language-server and static lanes
   * are already described by {@link indexer}, and inventing a provenance row
   * for them would put a fabricated build-universe fingerprint and manifest
   * digest next to real ones, which is the opposite of what this field is for.
   *
   * Nothing here records what the provider *did* to compute the generation.
   * Computation mode is a property of one refresh, not of the facts: a
   * resident session that reused its program and a one-shot build that loaded
   * it from scratch can publish identical facts, and recording the difference
   * would make two dumps of the same unedited checkout differ — the one
   * property this structure's contract rests on. It is reported through the
   * session and the indexer result instead.
   */
  provenance?: ISamchonGraphDump.IProvenance[];

  /** Every node the build recorded. */
  nodes: ISamchonGraphDump.INode[];

  /** Every edge the build resolved. */
  edges: ISamchonGraphDump.IEdge[];

  /**
   * What the language server said about the source while it indexed it. Absent
   * when the dump was built without one — a static parse has nobody to ask.
   */
  diagnostics?: ISamchonGraphDiagnostic[];

  /** Non-fatal problems encountered while building the graph. */
  warnings?: string[];
}

export namespace ISamchonGraphDump {
  /**
   * One strict provider's claim about the slice it contributed.
   *
   * The reference contract carries a single provenance object, because one
   * TypeScript `Program` produced its whole dump. A multi-language graph has no
   * such single program: TypeScript's checker, a Clang compilation universe,
   * and a Go semantic index can each own part of one dump, and collapsing them
   * into one row would have to invent a tool name, a version, and a build
   * fingerprint that describe none of them. So the claim is per provider, and a
   * reader asks which slice it is reading before trusting a fingerprint.
   */
  export interface IProvenance {
    /** Registry name of the provider that produced this slice. */
    provider: string;

    /** The languages it replaced atomically, in the order it published them. */
    languages: GraphLanguage[];

    /** What its facts are grounded in. */
    authority: GraphProviderAuthority;

    /**
     * The edge families it is registered to prove.
     *
     * A reader distinguishes "this provider proved there are no calls here"
     * from "this provider cannot prove calls at all" by asking whether `calls`
     * appears here — a question an empty edge list cannot answer.
     */
    facts: GraphEdgeKind[];

    /** What the producer claims it collected, in the producer's own words. */
    capabilities: string[];

    /** Which program produced the facts. */
    producer: IProducer;

    /**
     * Fingerprint of the inputs that decided which files are in the program.
     *
     * Facts must never be carried across a snapshot whose fingerprint moved: a
     * change to it can add or drop whole files, so the two generations are not
     * two views of one program.
     */
    universe: string;

    /** Digest over the exact input manifest the facts were computed from. */
    manifest: string;

    /** Digest over the facts this slice published, in publication order. */
    content: string;
  }

  /** The program that produced one slice. */
  export interface IProducer {
    /** The producing tool's name, such as `ttscgraph`. */
    tool: string;

    /** The tool's build version, or `""` when it carries none. */
    version: string;

    /**
     * The language version the tool's checker implements.
     *
     * Separate from {@link version} because a tool and the checker it embeds do
     * not share a version line, and a consumer comparing language behaviour
     * needs the checker's.
     */
    compiler: string;

    /** The version of the dump body contract the producer emitted. */
    schemaVersion: number;

    /** The wire protocol version the producer spoke. */
    protocolVersion: number;
  }

  /**
   * A node as the indexer sends it: the graph node, minus the file paths inside
   * its spans, which the loader puts back from the node's own `file`.
   *
   * A node's declaration span is in the node's file, always — the path in the
   * span was the same string a second time, once per node. It is the reader's
   * to reconstruct, and {@link SamchonGraphMemory} does, so nothing downstream
   * of the loader sees a span without its file.
   */
  export interface INode
    extends Omit<ISamchonGraphNode, "evidence" | "implementation"> {
    /** Declaration span; its file is this node's `file`. */
    evidence?: ISamchonGraphSpan;

    /**
     * Implementation span. This one keeps its file when it has one: an
     * implementation genuinely can live in another file from its declaration.
     */
    implementation?: ISamchonGraphSpan;
  }

  /**
   * An edge as the indexer sends it. Its span is in its source node's file,
   * looked up by the opaque id when necessary, so the path need not ride the
   * wire a second time on every edge.
   */
  export interface IEdge extends Omit<ISamchonGraphEdge, "evidence"> {
    /** Expression span; its file is the source node's declaration file. */
    evidence?: ISamchonGraphSpan;
  }
}
