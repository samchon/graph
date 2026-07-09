import { GraphLanguage } from "../typings/GraphLanguage";
import { ISamchonGraphDecorator } from "./ISamchonGraphDecorator";
import { ISamchonGraphDiagnostic } from "./ISamchonGraphDiagnostic";
import { ISamchonGraphNext } from "./ISamchonGraphNext";

/** Answer-ready, source-free tour evidence for broad code-flow questions. */
export interface ISamchonGraphTour {
  /** Discriminator for code-tour indexing. */
  type: "tour";

  /** Natural code question this tour was built for. */
  query: string;

  /** Central entrypoints selected for the tour. */
  entrypoints: ISamchonGraphTour.INode[];

  /** Selected primary runtime flows; sufficient for an index-level tour. */
  primaryFlow: ISamchonGraphTour.IFlow[];

  /** Nearby dependency anchors around the selected entrypoints. */
  nearby: ISamchonGraphTour.IAnchor[];

  /** Test or usage anchors reached through graph impact edges. */
  tests: ISamchonGraphTour.IAnchor[];

  /** Ordered file/line anchors to cite in the final answer, not file reads. */
  answerAnchors: ISamchonGraphTour.IAnchor[];

  /** Diagnostics collected while building the tour. */
  diagnostics?: ISamchonGraphDiagnostic[];

  /** How to use this source-free result next. */
  next: ISamchonGraphNext;

  /** Human-readable compatibility note mirroring `next`. */
  guide: string;

  /** True when any internal slice hit its cap. */
  truncated?: boolean;
}

export namespace ISamchonGraphTour {
  /**
   * Build the complete index-level answer surface for broad code tours: central
   * entrypoints, primary flow, nearby paths, tests, and answer anchors. Use
   * this instead of decomposing repository-orientation, read-next,
   * architecture, or multi-phase runtime-flow questions into many
   * lookup/details/trace calls.
   */
  export interface IRequest {
    /** Discriminator for code-tour indexing. */
    type: "tour";

    /** The user's natural code-tour question. */
    query: string;

    /** Target source language for the tour. */
    language?: GraphLanguage;

    /**
     * Maximum central entrypoints to seed the tour.
     *
     * Prefer the default. Raise only when the question names several distinct
     * public paths that must all appear in one answer.
     *
     * @default 4
     */
    limit?: number;

    /**
     * Include graph-reached test or usage anchors when available.
     *
     * @default true
     */
    includeTests?: boolean;
  }

  /** A compact symbol coordinate for a tour. */
  export interface INode {
    /** Stable node id for later graph calls. */
    id: string;

    /** Qualified symbol name when available, otherwise the simple name. */
    name: string;

    /** Declaration kind (`class`, `method`, `function`, ...). */
    kind: string;

    /** Project-relative declaration file. */
    file: string;

    /** 1-based declaration line, when known. */
    line?: number;

    /** Declaration or implementation range, when known. */
    sourceSpan?: ISamchonGraphTour.ISpan;

    /** Declaration head, when available. */
    signature?: string;

    /** Decorators written on the declaration, when any. */
    decorators?: ISamchonGraphDecorator[];
  }

  /** A primary flow slice from one selected entrypoint. */
  export interface IFlow {
    /** Flow start node. */
    start: ISamchonGraphTour.INode;

    /** Compact edge summaries in graph order. */
    steps: string[];

    /** Nodes reached by this flow. */
    reached: ISamchonGraphTour.INode[];

    /** Edge and node anchors that explain the flow. */
    anchors: ISamchonGraphTour.IAnchor[];

    /** True when the flow hit graph caps. */
    truncated?: boolean;
  }

  /** A file/line citation chosen by the graph, not source body text. */
  export interface IAnchor {
    /** Why this anchor matters in the tour. */
    reason: string;

    /** Stable node id when the anchor belongs to a node. */
    id?: string;

    /** Symbol, edge, or test name to show in the answer. */
    name: string;

    /** Declaration kind, when this anchor belongs to a node. */
    kind?: string;

    /** Project-relative file. */
    file: string;

    /** 1-based start line. */
    startLine: number;

    /** 1-based end line, when known. */
    endLine?: number;
  }

  /** Source coordinates without source text. */
  export interface ISpan {
    /** Project-relative file. */
    file: string;

    /** 1-based start line. */
    startLine: number;

    /** 1-based end line, when known. */
    endLine?: number;
  }
}
