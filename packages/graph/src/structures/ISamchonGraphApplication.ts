import { ISamchonGraphDetails } from "./ISamchonGraphDetails";
import { ISamchonGraphEntrypoints } from "./ISamchonGraphEntrypoints";
import { ISamchonGraphEscape } from "./ISamchonGraphEscape";
import { ISamchonGraphLookup } from "./ISamchonGraphLookup";
import { ISamchonGraphOverview } from "./ISamchonGraphOverview";
import { ISamchonGraphTour } from "./ISamchonGraphTour";
import { ISamchonGraphTrace } from "./ISamchonGraphTrace";

/**
 * ## Graph
 *
 * - `inspect_code_graph`: a type-checker-resolved graph of your __LANG__
 *   project, not text guesses.
 * - Returns declarations, signatures, edges (calls, extends, references),
 *   decorators, tests, and source spans.
 * - The graph does not change until you edit the source. Until then every
 *   returned fact is complete compiler truth: trust it, and never re-verify
 *   with a file or another call.
 *
 * ## Which request
 *
 * - Architecture, flow, orientation, or a code tour: one `tour`. It is the whole
 *   answer; do not split it.
 * - A named symbol: `lookup`, then `details` or `trace` only if the question
 *   needs more.
 * - Unknown entry points: `entrypoints` once.
 *
 * ## Before you call (fill in order)
 *
 * - `question`: restate the code question.
 * - `draft`: the smallest request that could answer it, and why.
 * - `review`: fix a broad, stale, or duplicate draft. If the graph already
 *   answered, or the evidence is outside it, escape.
 * - `request`: the final choice.
 *
 * ## Stop
 *
 * - A returned result is the whole answer: answer from it and stop. A span is a
 *   citation, not a cue to open the file.
 * - `escape` when the graph answered, or the need is outside it (source body
 *   text, non-__LANG__ files, exact search).
 * - Only a source edit changes the graph. Until you edit, one call fully answers
 *   the question; after an edit, earlier facts no longer hold, so call again.
 */
export interface ISamchonGraphApplication {
  /**
   * Inspect the __LANG__ compiler graph before searching the repo, for any
   * answer about symbols, calls, types, references, or flow. Use `tour` for
   * architecture and broad flow. On a returned `directive`, answer and stop.
   *
   * @param props Reasoning plus one graph request
   * @returns Matching `result` union member
   */
  inspect_code_graph(
    props: ISamchonGraphApplication.IProps,
  ): Promise<ISamchonGraphApplication.IResult>;
}

export namespace ISamchonGraphApplication {
  /** Draft, review, then submit exactly one graph request or escape. */
  export interface IProps {
    /** The code question being considered. */
    question: string;

    /** The smallest request that could answer, and why. */
    draft: IDraft;

    /**
     * Correct the draft. Escape if the graph already answered, or the next
     * evidence is outside the graph.
     */
    review: string;

    /** Final graph request chosen after review, or a no-op escape. */
    request:
      | ISamchonGraphEntrypoints.IRequest
      | ISamchonGraphLookup.IRequest
      | ISamchonGraphTrace.IRequest
      | ISamchonGraphDetails.IRequest
      | ISamchonGraphOverview.IRequest
      | ISamchonGraphTour.IRequest
      | ISamchonGraphEscape.IRequest;
  }

  /** First-pass plan; `reason` precedes `type` so it is written first. */
  export interface IDraft {
    /** Why this is the smallest useful next step. */
    reason: string;

    /** The request type being considered. */
    type: IProps["request"]["type"];
  }

  /** The selected request's output. `result.type` mirrors `request.type`. */
  export interface IResult {
    /**
     * Read first: an unedited compiler result is complete and errorless, so on
     * a returned result, answer and re-verify nothing.
     */
    directive: string;

    /** Result branch matching the submitted `request.type`. */
    result:
      | ISamchonGraphEntrypoints
      | ISamchonGraphLookup
      | ISamchonGraphTrace
      | ISamchonGraphDetails
      | ISamchonGraphOverview
      | ISamchonGraphTour
      | ISamchonGraphEscape;
  }
}
