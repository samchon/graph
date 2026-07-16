import { ILspSession } from "../indexer/ILspSession";
import { IBulkGraphSession } from "./IBulkGraphSession";

/** Whether a resident language session publishes whole compiler snapshots. */
export function isBulkGraphSession(
  session: ILspSession | IBulkGraphSession,
): session is IBulkGraphSession {
  return "kind" in session && session.kind === "bulk";
}
