import {
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
    /** Source texts observed for the files named by this snapshot. */
    sources: Map<string, string>;
    warnings: string[];
  }

  /** Result of polling a resident compiler session. */
  export interface IRefresh {
    changed: boolean;
    generation: number;
    mode: string;
    snapshot: ISnapshot;
  }
}
