import { ISamchonGraphDump } from "../structures";
import { indexOf } from "./indexOf";

/**
 * Audit for the ranked shortlists returned by `lookup`, `entrypoints`, and
 * `tour`.
 *
 * Every returned fact is still checked against the current index. What this
 * audit does not pretend is that a natural-language match, score, per-file cap,
 * and result limit form an exhaustive answer to the caller's question.
 */
export function RESULT_AUDIT_SELECTION(
  indexer: ISamchonGraphDump["indexer"],
): string {
  return `
AUDITED BEFORE RETURNING. READ FIRST.

The server assembled this \`result\` from ${indexOf(indexer)} for the snapshot this call
synced to, then checked every returned name, span, edge, and signature against that same
index. Each returned fact is exactly what that index holds for the snapshot: a returned
span is the citation, not a cue to open the file merely to confirm it.

What was selected is heuristic, not exhaustive. This result was matched against your
natural-language question, scored and ranked, held to a few hits per file, and cut to a
limit; a \`score\` is that ranking, and \`truncated\` marks where more was left out. Judge
whether the shortlist covers what you asked. If it does not, refining the request, raising
the limit, or reading a cited span for information the graph does not carry is a sound next
step, not a failure to trust the facts returned here.

Follow \`next\` for where that leaves the question.
`.trim();
}
