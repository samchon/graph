/**
 * A diagnostic the language server published while it was indexing, carried on
 * the dump beside the facts it was reported against.
 *
 * It states what the server said, and nothing more. It used to also promise an
 * `origin` lane and the `node` the finding was "fused onto" — two facts no
 * producer ever set and no consumer ever read, in a package whose whole premise
 * is that a returned fact was resolved rather than claimed. A schema that
 * promises a fact the code does not honour is the same lie as a payload that
 * does, and it is cheaper to delete than to defend.
 */
export interface ISamchonGraphDiagnostic {
  /** Project-relative path of the file the diagnostic is reported in. */
  file: string;

  /** 1-based line of the diagnostic. */
  line: number;

  /** 1-based column of the diagnostic, when known. */
  column?: number;

  /** The server's own code for the finding, or its source when it gave none. */
  code: number | string;

  /** The human-readable diagnostic message. */
  message: string;

  /** Severity, when the producer distinguishes it. */
  severity?: "error" | "warning" | "info" | "hint";
}
