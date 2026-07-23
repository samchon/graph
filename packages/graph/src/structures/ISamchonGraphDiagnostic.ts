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
  /**
   * Schema-v6 graph file identity the diagnostic names, relative to the dump
   * project (including `../` siblings), `bundled:///` for a virtual library, or
   * `""` for a global finding.
   */
  file: string;

  /** 1-based line, or `0` only for a global finding whose `file` is empty. */
  line: number;

  /** 1-based column when known; required as `0` for a global finding. */
  column?: number;

  /** The server's own code for the finding, or its source when it gave none. */
  code: number | string;

  /** The human-readable diagnostic message. */
  message: string;

  /** Severity, when the producer distinguishes it. */
  severity?: "error" | "warning" | "info" | "hint";
}
