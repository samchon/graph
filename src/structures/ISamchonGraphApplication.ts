import { IGraphDetails } from "./IGraphDetails";
import { IGraphEntrypoints } from "./IGraphEntrypoints";
import { IGraphEscape } from "./IGraphEscape";
import { IGraphLookup } from "./IGraphLookup";
import { IGraphOverview } from "./IGraphOverview";
import { IGraphTour } from "./IGraphTour";
import { IGraphTrace } from "./IGraphTrace";

/**
 * One MCP application surface for every supported language.
 *
 * Use this for architecture, runtime flow, APIs, callers/callees, type
 * relations, dependency orientation, diagnostics, and source-span anchors across
 * strongly typed compiled languages. It returns a graph index: names,
 * signatures, spans, diagnostics, and edges. It never returns source bodies.
 *
 * When the graph was built by LSP, returned facts are language-server/compiler
 * facts for the indexed snapshot. When it was built by static fallback, the
 * result carries the same contract but may be approximate; the `indexer` field
 * on dumps and CLI warnings tell you which path was used.
 */
export interface ISamchonGraphApplication {
  /**
   * Inspect the resident multi-language code graph.
   *
   * Fill `question`, `draft`, and `review`, then choose exactly one request
   * branch. If the answer is outside declarations, references, calls, types,
   * diagnostics, or source-span anchors, choose `escape`.
   */
  inspect_code_graph(
    props: ISamchonGraphApplication.IProps,
  ): Promise<ISamchonGraphApplication.IResult>;
}

export namespace ISamchonGraphApplication {
  export interface IProps {
    question: string;
    draft: IDraft;
    review: string;
    request:
      | IGraphEntrypoints.IRequest
      | IGraphLookup.IRequest
      | IGraphTrace.IRequest
      | IGraphDetails.IRequest
      | IGraphOverview.IRequest
      | IGraphTour.IRequest
      | IGraphEscape.IRequest;
  }

  export interface IDraft {
    reason: string;
    type: IProps["request"]["type"];
  }

  export interface IResult {
    result:
      | IGraphEntrypoints
      | IGraphLookup
      | IGraphTrace
      | IGraphDetails
      | IGraphOverview
      | IGraphTour
      | IGraphEscape;
  }
}
