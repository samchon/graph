import { IGraphEvidence } from "./IGraphEvidence";

/**
 * A language server or plugin diagnostic, fused onto the graph so an edit-triage
 * query can name the owning symbol of an error.
 *
 * The language server's semantic pass contributes numeric-coded diagnostics;
 * lint rules and transform plugins (typia, nestia, …) contribute `plugin`/`lint`
 * findings whose `code` is a string.
 */
export interface IGraphDiagnostic {
  /** Project-relative path of the file the diagnostic is reported in. */
  file: string;

  /** The human-readable diagnostic message. */
  message: string;

  /** Severity, when the producer distinguishes it. */
  severity: "error" | "warning" | "information" | "hint";

  /** Which producer emitted the diagnostic. */
  source?: string;

  /** Numeric language server code, or string rule id for a lint/plugin finding. */
  code?: string | number;

  /** The source span the diagnostic was attributed to, when resolved. */
  evidence?: IGraphEvidence;
}
