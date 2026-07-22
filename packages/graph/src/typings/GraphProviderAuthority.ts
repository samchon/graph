/**
 * What a provider's facts are grounded in, strongest first.
 *
 * A consumer degrades against this rather than against a provider's name,
 * because "the compiler resolved this" and "an index built to answer editor
 * navigation reports this" are different claims. A reader that cannot tell
 * them apart cannot know whether a missing edge means the relationship is
 * absent or merely unproven, which is the one question an audit exists to
 * answer.
 *
 * - `compiler`: the language's own checker resolved them.
 * - `analyzer`: a whole-project analyzer that implements the language's
 *   semantics without being its compiler.
 * - `semantic-index`: a precomputed whole-workspace semantic artifact.
 * - `navigation`: an editor index built to answer navigation requests.
 * - `heuristic`: a best-effort syntactic extraction.
 */
export type GraphProviderAuthority =
  | "compiler"
  | "analyzer"
  | "semantic-index"
  | "navigation"
  | "heuristic";
