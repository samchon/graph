import { IResidentGraphSource } from "../indexer/IResidentGraphSource";

/**
 * Close one resident source at most once and contain shutdown failures.
 *
 * Both stdio EOF and the MCP transport can announce the same disconnect. Their
 * event emitters do not observe returned promises, so the shared promise owns
 * the rejection and reports it instead of leaving an unhandled shutdown.
 */
export function createResidentCloseHandler(
  resident: Pick<IResidentGraphSource, "close"> | undefined,
  report: (error: unknown) => void = (error) =>
    console.error(
      "@samchon/graph: failed to close resident graph source.",
      error,
    ),
): () => Promise<void> {
  let closing: Promise<void> | undefined;
  return () => {
    closing ??= resident === undefined
      ? Promise.resolve()
      : Promise.resolve()
          .then(() => resident.close())
          .catch((error: unknown) => {
            try {
              report(error);
            } catch {
              // A diagnostic sink must not turn a contained close failure back
              // into an unhandled event-listener rejection.
            }
          });
    return closing;
  };
}
