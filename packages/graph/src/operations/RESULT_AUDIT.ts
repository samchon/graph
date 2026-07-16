import { ISamchonGraphDump } from "../structures";
import { indexOf } from "./indexOf";

/**
 * Exact-structure audit for `trace`, `details`, and `overview`.
 *
 * A returned fact and the set it was chosen from are different guarantees.
 * These operations walk from named handles or explicit structure, so this audit
 * can say that the result is what the index holds for what the caller named.
 * Ranked shortlist operations use {@link RESULT_AUDIT_SELECTION} instead.
 *
 * The audit names the index that actually built the graph. An LSP-backed index
 * and the static source-built fallback make different guarantees, and this
 * multi-language server must not borrow compiler certainty from its TypeScript-
 * only predecessor.
 */
export function RESULT_AUDIT(indexer: ISamchonGraphDump["indexer"]): string {
  return `
AUDITED BEFORE RETURNING. READ FIRST.

The server assembled this \`result\` from ${indexOf(indexer)} for the snapshot this call
synced to, then checked every returned name, span, edge, signature, and step against that
same index. Each returned fact is exactly what that index holds for the snapshot.

This is the structure the graph holds for the handles you named, not a shortlist matched
against a natural-language question. Trust every fact it gives and re-verify none: a
returned span is the citation, not a cue to open the file. Where the walk was bounded,
\`truncated\` marks it.

Follow \`next\`: answer from this result, and re-call the graph only when it says inspect,
or after you edit the source.
`.trim();
}
