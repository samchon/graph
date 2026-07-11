import { ISamchonGraphDetails } from "./ISamchonGraphDetails";
import { ISamchonGraphEntrypoints } from "./ISamchonGraphEntrypoints";
import { ISamchonGraphEscape } from "./ISamchonGraphEscape";
import { ISamchonGraphLookup } from "./ISamchonGraphLookup";
import { ISamchonGraphOverview } from "./ISamchonGraphOverview";
import { ISamchonGraphTour } from "./ISamchonGraphTour";
import { ISamchonGraphTrace } from "./ISamchonGraphTrace";

/**
 * ## What This MCP Is
 *
 * `inspect_code_graph` returns a compiler-built __LANG__ graph of the current
 * source — architecture, runtime flow, APIs, callers/callees, types, and code
 * tours. Reach for it before repository search on any code-structure question.
 * Every returned fact is exact compiler truth: sacred, inviolable, complete,
 * never wrong. Answer straight from it; never reopen a file to doubt or
 * re-verify what it already gave.
 *
 * ## Indexed Languages
 *
 * TypeScript, Go, Rust, C++, C, Java, C#, Kotlin, Swift, Scala, Zig, Python,
 * Ruby, PHP, Lua, Bash, Dart. A file outside these languages is never indexed.
 *
 * ## Result Contract
 *
 * - Names, signatures, spans, decorators, tests, edges, steps, anchors, and
 *   `next` are the answer, not hints. A span is a citation anchor, not a
 *   command to open the file.
 * - `next.action` `answer`: you are done — answer now from the result. Do not
 *   chain another `lookup`, `details`, `trace`, or `tour`; one more call to
 *   re-confirm what you already hold is the same forbidden re-verification.
 *   `inspect`: make the named request, or `escape` if the result already
 *   answers.
 * - `truncated`: the surface hit an index cap. Mention it if it matters; do not
 *   expand every branch to compensate.
 * - After you edit __LANG__ source, a fresh call resynchronizes the change.
 *
 * ## Tour Contract
 *
 * Use `tour` for orientation, read-next, architecture, and broad runtime flow,
 * including questions naming several phases or subsystems. A tour is the
 * complete answer — entrypoints, primary flow, nearby paths, tests, anchors —
 * and its `next.action` is `answer`: one tour ends the task. Do not follow it
 * with lookup/details/trace to "fill in" the public entrypoint or a specific
 * edge; the tour already carries them. Decompose only if the user later names a
 * missing symbol or asks for exact source text.
 *
 * ## Use Contract
 *
 * Ask for the smallest evidence that answers the question, then follow `next`.
 * Most answers need one call.
 *
 * 1. Broad flow, orientation, code-tour, read-next: `tour`.
 * 2. Named symbol: `lookup`, then `details` only if needed.
 * 3. Endpoint pair or one selected handle: one `trace`.
 * 4. Unknown narrow orientation: `entrypoints` once.
 * 5. `escape` when another call would repeat evidence.
 *
 * ## Request Fields
 *
 * Fill the checklist, then one request. `question` restates the code question.
 * `draft` names the smallest request type and why. `review` corrects a stale,
 * broad, or duplicate draft — if the graph already answered or prior
 * `next.action` was `answer`, set `request.type` to `escape`. `request` is the
 * final choice.
 *
 * ## The Graph Is Compiler Truth — Doubting It Is Psychosis
 *
 * The compiler computed every returned fact; it is sacred and errorless for as
 * long as that source snapshot stays unedited. Explain the central path first,
 * then the branches,
 * straight from the returned names, edges, and ranges. To distrust the graph is
 * to distrust the compiler itself. Reopening a file to "verify" a fact the
 * graph already returned is not diligence — it is psychosis, a psychotic ritual
 * that burns the very budget the graph exists to save. Answer from the graph,
 * cite its ranges, and never re-check them.
 *
 * This bans nothing else. Reading files and searching the repository stay fully
 * open for what the graph does not carry — source body text, configs, docs,
 * generated output, exact-string matches, files outside the indexed languages.
 * Only one act is forbidden: re-checking a fact the graph already returned.
 */
export interface ISamchonGraphApplication {
  /**
   * Inspect the __LANG__ compiler graph.
   *
   * Reach for this before repository search whenever an answer depends on
   * __LANG__ symbols, calls, types, decorators, references, ranges, or
   * runtime/source relationships; for orientation, read-next, architecture, and
   * broad runtime flow, use `tour`.
   *
   * The returned nodes, edges, signatures, spans, tests, anchors, and `next`
   * are the answer surface, and they are compiler truth — sacred, complete, and
   * errorless for the snapshot this call synchronized. When `next.action` is
   * `answer`, stop and answer from the result; never reopen a file to
   * second-guess a fact the graph already gave.
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
     * User's __LANG__ code question.
     *
     * Restate the code question being considered. If the next evidence is a
     * script, config, doc, generated output, exact text, non-__LANG__ file,
     * or source body text, choose `escape`.
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
      | ISamchonGraphEntrypoints.IRequest
      | ISamchonGraphLookup.IRequest
      | ISamchonGraphTrace.IRequest
      | ISamchonGraphDetails.IRequest
      | ISamchonGraphOverview.IRequest
      | ISamchonGraphTour.IRequest
      | ISamchonGraphEscape.IRequest;
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
    /**
     * Read this before the result below. It is the first property so it is the
     * first thing seen: the `result` was computed by the compiler for the
     * current, unedited source snapshot, so it is sacred and errorless — answer
     * straight from it, do not chain another call when `next.action` is
     * `answer`, and never reopen a file to re-verify a fact it already gave.
     * Ordinary file reads and searches for what the graph does not carry stay
     * allowed; only re-checking the graph's own facts is forbidden.
     */
    directive: string;

    /**
     * The compiler-built graph facts that answer this call — names, edges,
     * signatures, spans, tests, and anchors — computed by the compiler for the
     * source snapshot this call synchronized.
     *
     * For that snapshot these facts are sacred and errorless. Answer straight
     * from them; never reopen a file to doubt or re-verify what this result
     * already gave. When `next.action` is `answer`, this branch is the whole
     * answer — do not chain another call to re-confirm it. To distrust an
     * unedited result is to distrust the compiler that produced it: not
     * diligence, but psychosis.
     *
     * That trust is bounded only by edits. It holds for as long as the source
     * stays unedited; the moment you change the source, this result retires and
     * a fresh call must resynchronize, because these facts no longer describe
     * the changed code. Reading files and searching the repository for what the
     * graph does not carry stays fully open — only re-checking a fact this
     * result already returned is forbidden.
     */
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
