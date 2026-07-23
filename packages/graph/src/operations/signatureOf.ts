import { SamchonGraphMemory } from "../SamchonGraphMemory";
import { ISamchonGraphNode } from "../structures";

// A signature is the declaration head up to the body brace: a handful of lines.
const MAX_SIGNATURE_LINES = 4;

/**
 * The declaration signature: the head of the declaration up to and including
 * the line that opens its body (`{`), or the single declaration line when there
 * is no brace, capped so a wrapped signature cannot run away.
 */
export function signatureOf(
  graph: SamchonGraphMemory,
  node: ISamchonGraphNode,
): string | undefined {
  const owned = node.signature?.trim();
  if (owned !== undefined && owned !== "") return owned;
  const evidence = node.evidence;
  const lines =
    evidence === undefined ? undefined : graph.source.lines(evidence.file);
  if (lines === undefined || evidence === undefined) return undefined;
  const start = Math.max(0, evidence.startLine - 1);
  const last =
    evidence.endLine === undefined
      ? lines.length - 1
      : Math.min(lines.length - 1, evidence.endLine - 1);
  const out: string[] = [];
  for (let i = start; i <= last && out.length < MAX_SIGNATURE_LINES; i++) {
    const line = lines[i];
    /* c8 ignore next */
    if (line === undefined) break;
    out.push(line);
    if (line.includes("{") || line.trimEnd().endsWith(";")) break;
  }
  const text = out.join("\n").trim();
  return text === "" ? undefined : text;
}
