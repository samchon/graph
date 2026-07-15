import { ISamchonGraphNext } from "../structures";

/**
 * The stop rule, and the only thing that lifts it.
 *
 * `next` may carry only a fact about the request that was just answered, which
 * is the only thing the server is in a position to know: a handle that matched
 * several nodes, a handle that matched none, a path with no call edge across it,
 * or everything the request asked for. It may not claim to know what the
 * *question* meant — a question names concepts and a graph holds identifiers, and
 * no lexical rule bridges the two, so a coverage claim is a match dressed as a
 * fact, inside the one payload that swore it had none.
 *
 * That matters because a wrong `next` does not merely misdirect a call: the audit
 * ends "Re-call the graph only when `next` says inspect", so a false `inspect`
 * lifts the stop.
 */
export function resultNext(
  action: ISamchonGraphNext["action"],
  reason: string,
  request?: ISamchonGraphNext["request"],
): ISamchonGraphNext {
  return {
    action,
    reason,
    ...(request !== undefined ? { request } : {}),
  };
}
