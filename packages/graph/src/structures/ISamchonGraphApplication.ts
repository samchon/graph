import { IGraphDetails } from "./IGraphDetails";
import { IGraphEntrypoints } from "./IGraphEntrypoints";
import { IGraphEscape } from "./IGraphEscape";
import { IGraphLookup } from "./IGraphLookup";
import { IGraphOverview } from "./IGraphOverview";
import { IGraphTour } from "./IGraphTour";
import { IGraphTrace } from "./IGraphTrace";

/**
 * A resident code graph of this repository: every declaration, signature,
 * source span, diagnostic, and relationship edge (calls, types, inheritance,
 * containment, references), already indexed and queryable in one call.
 *
 * REACH FOR THIS FIRST — before grep, directory listings, or file reading.
 * One `tour` or `overview` request replaces dozens of file reads for
 * orientation ("how does X work", "trace this flow", "who calls this", "what
 * are the entrypoints"); `lookup`/`trace`/`details` answer symbol questions
 * with resolved facts instead of text matches. Fall back to reading source
 * only for exact statement-level bodies the graph deliberately omits.
 *
 * When the graph was built by LSP, returned facts are language-server/compiler
 * facts for the indexed snapshot — trust them without re-verifying by grep.
 * When it was built by static fallback, the result carries the same contract
 * but may be approximate; the `indexer` field tells you which path was used.
 */
export interface ISamchonGraphApplication {
  /**
   * Answer codebase questions from the pre-built code graph — architecture,
   * runtime flow, entrypoints, callers/callees, type relations, symbol
   * definitions — in one call, instead of grepping and reading files.
   *
   * Start with `tour` (orientation) or `overview`; use `lookup` to find a
   * symbol, `trace` to follow a flow, `details` for one symbol's facts. Fill
   * `question`, `draft`, and `review`, then choose exactly one request branch.
   * If the answer is outside declarations, references, calls, types,
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
