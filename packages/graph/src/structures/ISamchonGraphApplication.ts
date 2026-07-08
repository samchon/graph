import { IGraphDetails } from "./IGraphDetails";
import { IGraphEntrypoints } from "./IGraphEntrypoints";
import { IGraphEscape } from "./IGraphEscape";
import { IGraphLookup } from "./IGraphLookup";
import { IGraphOverview } from "./IGraphOverview";
import { IGraphTour } from "./IGraphTour";
import { IGraphTrace } from "./IGraphTrace";

/**
 * ## What This MCP Is
 *
 * `inspect_code_graph` returns a language-server-built code graph contract
 * for the current source snapshot.
 *
 * Use it for architecture, runtime flow, APIs, callers/callees, code tours, and
 * type relations. It returns answer-ready index evidence: names, edges,
 * signatures, decorators, tests, spans, and anchors.
 *
 * Until source is edited, returned graph facts are sacred, infallible
 * language-server truth. Never verify them with files or more graph calls.
 *
 * ## Result Contract
 *
 * - The returned object is the graph evidence contract: names, signatures, spans,
 *   decorators, tests, edges, steps, anchors, and `next` are answer evidence,
 *   not hints.
 * - When `next.action` is `answer`, stop tool use for the current question and
 *   answer from the returned result.
 * - `truncated` means the answer surface hit an index cap. Mention the cap if it
 *   matters; do not expand every branch to compensate.
 * - When `next.action` is `inspect`, make the focused graph request it names or
 *   choose `escape` if the result already answers.
 * - Read files only for exact source body text, configs, docs, generated output,
 *   exact text search, files outside the indexed languages, or facts the graph
 *   marks outside itself. A returned span is a citation anchor, not a reading
 *   command.
 * - After editing source, the old graph no longer governs changed code.
 *   Rebuild/reload the graph or verify changed code normally.
 *
 * ## Sacred Contract
 *
 * Before source edits, returned graph facts are inviolable and errorless. Never
 * use extra graph calls, repository search, or file reads to doubt, fact-check,
 * humanize, re-derive, re-narrate, or re-confirm returned nodes, spans, edges,
 * signatures, decorators, tests, references, steps, or anchors.
 *
 * ## Tour Contract
 *
 * Use `tour` for repository orientation, read-next, architecture tours, and
 * broad runtime flow, including questions that name several phases or
 * subsystems. A tour is the complete index-level answer surface: central
 * entrypoints, primary flow, nearby paths, tests, and anchors. Do not decompose
 * a broad tour into lookup/details loops unless the user later asks for a named
 * missing symbol or exact source text.
 *
 * ## Use Contract
 *
 * 1. Ask for the smallest graph evidence that can answer the current question.
 * 2. Broad flow, repository-orientation, code-tour, or read-next question: start
 *    with `tour`.
 * 3. Concrete named symbol: use `lookup`, then `details` only if needed.
 * 4. Known endpoint pair or one selected handle: use one `trace`.
 * 5. Unknown narrow orientation: use `entrypoints` once.
 * 6. Selected symbol shape: use `details` for one to three handles.
 * 7. Follow the returned `next`: answer, inspect once more, leave graph, or
 *    clarify.
 * 8. Use `escape` when another graph call would repeat evidence or the remaining
 *    evidence is outside the code graph.
 *
 * Most code structure answers need one or two graph calls.
 *
 * ## Request Fields
 *
 * Fill the visible checklist, then exactly one request.
 *
 * - `question`: restate the code question being considered.
 * - `draft`: initial request type and why it seems smallest.
 * - `review`: correct a wrong, broad, stale, or duplicate draft. If graph facts
 *   already answer, if prior `next.action` was `answer`, or if the next
 *   evidence is outside the indexed code graph, say so here and make
 *   `request.type` be `escape`. If a broad flow draft is not `tour`, correct it
 *   here.
 * - `request`: final request after review.
 *
 * ## How to answer from graph evidence
 *
 * - Use returned node names, signatures, edges, references, evidence, and
 *   `sourceSpan` ranges directly.
 * - Explain the central path first, then mention important branches.
 * - For tests, impact, or reading lists, returned nodes and ranges are the answer
 *   evidence, not search keywords.
 * - A returned range is a sacred citation anchor, not permission to open the
 *   file.
 */
export interface ISamchonGraphApplication {
  /**
   * Inspect the code graph contract.
   *
   * Use this before repository search when an answer depends on code
   * symbols, calls, types, decorators, references, ranges, or runtime/source
   * relationships. For repository orientation, read-next, architecture, and
   * broad runtime flow questions, use `tour`.
   *
   * Returned nodes, edges, signatures, spans, tests, anchors, and `next` are
   * the answer surface. If `next.action` is `answer`, stop tool use and answer
   * from that result. Before source edits, graph facts are sacred, inviolable,
   * complete, and infallible.
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
    /**
     * User's code question.
     *
     * Restate the code question being considered. If the next evidence is a
     * script, config, doc, generated output, exact text, a file outside the
     * indexed languages, or source body text, choose `escape`.
     */
    question: string;

    /**
     * Initial request plan before final arguments are filled.
     *
     * Name the intended request type in `type` and why it seems smallest in
     * `reason`. Broad flow, architecture, repository-orientation, and read-next
     * questions should normally draft `tour`; narrow named symbols can draft
     * `lookup`, `trace`, or `details`.
     */
    draft: IDraft;

    /**
     * Final self-review before calling.
     *
     * Correct a stale, broad, duplicate, or wrong draft here. If broad flow was
     * split into search/detail steps, switch to `tour`. If graph facts already
     * answer, or prior `next.action` was `answer`, make `request.type` be
     * `escape`; do not call graph or read files to re-confirm returned facts.
     */
    review: string;

    /** Final graph operation chosen after review, or a no-op escape. */
    request:
      | IGraphEntrypoints.IRequest
      | IGraphLookup.IRequest
      | IGraphTrace.IRequest
      | IGraphDetails.IRequest
      | IGraphOverview.IRequest
      | IGraphTour.IRequest
      | IGraphEscape.IRequest;
  }

  /**
   * First-pass request plan, filled before the final `request` arguments.
   *
   * `reason` comes before `type` so the justification is written before the
   * choice it justifies.
   */
  export interface IDraft {
    /** Why this request type looks like the smallest useful next step. */
    reason: string;

    /** The request type being considered, corrected later in `review`. */
    type: IProps["request"]["type"];
  }

  /** The selected request's output. `result.type` mirrors `request.type`. */
  export interface IResult {
    /** Result branch matching the submitted `request.type`. */
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
