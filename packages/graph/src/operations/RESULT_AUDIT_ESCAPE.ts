/**
 * The audit an escape carries.
 *
 * An escape runs no graph operation and returns no node, span, edge, signature,
 * or step — so it has nothing to have audited, and {@link RESULT_AUDIT}'s claim
 * that every fact in the result was resolved against the type-checked program
 * would be a claim about an empty set, dressed as a guarantee. A payload that
 * swears it holds no matched or inferred fact must not itself be one.
 */
export const RESULT_AUDIT_ESCAPE: string =
  "This escape carries no graph facts to audit.";
