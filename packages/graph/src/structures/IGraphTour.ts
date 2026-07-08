import { GraphLanguage } from "./GraphLanguage";
import { IGraphDiagnostic } from "./IGraphDiagnostic";
import { IGraphEntrypoints } from "./IGraphEntrypoints";
import { IGraphNext } from "./IGraphNext";
import { IGraphOverview } from "./IGraphOverview";

/** Answer-ready, source-free tour evidence for broad code-flow questions. */
export interface IGraphTour {
  /** Discriminator for code-tour indexing. */
  type: "tour";

  /** Natural code question this tour was built for. */
  question?: string;

  /** Central entrypoints selected for the tour. */
  entrypoints: IGraphEntrypoints.IEntrypoint[];

  /** Selected primary runtime flows; sufficient for an index-level tour. */
  primaryFlow: string[];

  /** Nearby dependency anchors around the selected entrypoints. */
  nearbyPaths: IGraphOverview.INode[];

  /** Test or usage anchors reached through graph impact edges. */
  testAnchors: IGraphOverview.INode[];

  /** Ordered file/line anchors to cite in the final answer, not file reads. */
  answerAnchors: IGraphOverview.INode[];

  /** Diagnostics collected while building the tour. */
  diagnostics?: IGraphDiagnostic[];

  /** How to use this source-free result next. */
  next: IGraphNext;

  /** Human-readable compatibility note mirroring `next`. */
  guide: string;
}

export namespace IGraphTour {
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
    question?: string;

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
  }
}
