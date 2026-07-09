import { GraphLanguage } from "../typings/GraphLanguage";
import { ISamchonGraphDiagnostic } from "./ISamchonGraphDiagnostic";
import { ISamchonGraphEntrypoints } from "./ISamchonGraphEntrypoints";
import { ISamchonGraphNext } from "./ISamchonGraphNext";
import { ISamchonGraphOverview } from "./ISamchonGraphOverview";

/** Answer-ready, source-free tour evidence for broad code-flow questions. */
export interface ISamchonGraphTour {
  /** Discriminator for code-tour indexing. */
  type: "tour";

  /** Natural code question this tour was built for. */
  question?: string;

  /** Central entrypoints selected for the tour. */
  entrypoints: ISamchonGraphEntrypoints.IEntrypoint[];

  /** Selected primary runtime flows; sufficient for an index-level tour. */
  primaryFlow: string[];

  /** Nearby dependency anchors around the selected entrypoints. */
  nearbyPaths: ISamchonGraphOverview.INode[];

  /** Test or usage anchors reached through graph impact edges. */
  testAnchors: ISamchonGraphOverview.INode[];

  /** Ordered file/line anchors to cite in the final answer, not file reads. */
  answerAnchors: ISamchonGraphOverview.INode[];

  /** Diagnostics collected while building the tour. */
  diagnostics?: ISamchonGraphDiagnostic[];

  /** How to use this source-free result next. */
  next: ISamchonGraphNext;

  /** Human-readable compatibility note mirroring `next`. */
  guide: string;
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
