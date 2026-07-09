import { GraphLanguage } from "../typings/GraphLanguage";
import { ISamchonGraphDiagnostic } from "./ISamchonGraphDiagnostic";
import { ISamchonGraphEdge } from "./ISamchonGraphEdge";
import { ISamchonGraphNode } from "./ISamchonGraphNode";

/**
 * The whole-graph export `graph dump` writes and the MCP server loads — the
 * wire contract between the fact-builder and the graph engine.
 *
 * It is the complete graph with none of the per-response caps the MCP tools
 * apply: every node and edge the build resolved. The server parses it once at
 * startup (validated) into an in-memory resident graph and answers every
 * tool call from that warm model; the bundled 3D viewer reduces the same dump.
 *
 * Paths in `project` are absolute; `file` fields on nodes, edges, and
 * diagnostics are project-relative.
 */
export interface ISamchonGraphDump {
  /** Absolute path of the project root the graph was built for. */
  project: string;

  /** The source languages present in this dump. */
  languages: GraphLanguage[];

  /** ISO timestamp of when the dump was generated. */
  generatedAt: string;

  /** Which indexing strategy produced the graph. */
  indexer: "lsp" | "static" | "hybrid";

  /** Every node the build recorded. */
  nodes: ISamchonGraphNode[];

  /** Every edge the build resolved. */
  edges: ISamchonGraphEdge[];

  /**
   * Fused language server and plugin diagnostics, when diagnostics were
   * collected. Absent when the dump was built without a diagnostics pass.
   */
  diagnostics?: ISamchonGraphDiagnostic[];

  /** Non-fatal problems encountered while building the graph. */
  warnings?: string[];
}
