import { ISamchonGraphDump } from "../structures";
import { indexOf } from "./indexOf";

/** Audit for details, whose identity and fan-out have different bounds. */
export function RESULT_AUDIT_DETAILS(
  indexer: ISamchonGraphDump["indexer"],
  memberLimit?: number,
): string {
  const memberCoverage =
    memberLimit === undefined || !Number.isFinite(memberLimit)
      ? "its recorded members, values, and signature — is returned whole"
      : "its values and signature are returned whole, while members are returned only up to the caller's explicit cap; this result makes no whole-member claim";
  return `
AUDITED BEFORE RETURNING. READ FIRST.

The server assembled this \`result\` from ${indexOf(indexer)} for the snapshot this call
synced to, then checked every returned name, span, edge, signature, member, and value
against that same index. Each returned fact is exactly what that index holds.

This is the structure the graph records for the handles you named. What a symbol is —
${memberCoverage}; this does not claim a
generic fallback proved facts it never indexed. What a symbol reaches or is reached by —
its calls, type references, implementers, and under \`neighbors\` its dependents — is a
short orientation slice because that grows with usage; \`trace\` follows the relationship
graph further.

Follow \`next\`: answer from this result, and re-call the graph only when it says inspect,
or after you edit the source.
`.trim();
}
