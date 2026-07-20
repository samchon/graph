import { ISamchonGraphEvidence, ISamchonGraphSpan } from "../structures";

/**
 * The span, minus the file when it is the one the reader can already name (§6b).
 *
 * A node's declaration span is in the node's own `file`, and an edge's span is
 * in its source node's file. Both rode the wire a second and a third time, on
 * every node and on every edge, and
 * edges outnumber nodes several times over: 17% of the document was a value the
 * reader already held. {@link SamchonGraphMemory} puts it back before anything
 * reads it, so nothing downstream ever sees a span without its file.
 *
 * A span whose file is *not* derivable keeps it: an implementation genuinely can
 * live in another file from the declaration that owns it.
 */
export function spanWithoutFile(
  evidence: ISamchonGraphEvidence,
  derivable: string,
): ISamchonGraphSpan {
  const { file, ...rest } = evidence;
  return file === derivable ? rest : { file, ...rest };
}
