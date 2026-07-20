import { GraphLanguage } from "../typings/GraphLanguage";
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
