import { ISamchonGraphNode } from "../structures";
import { fileLines } from "./fileLines";

// A signature is the declaration head up to the body brace: a handful of lines.
const MAX_SIGNATURE_LINES = 4;

/**
 * The declaration signature: the head of the declaration up to and including
 * the line that opens its body (`{`), or the single declaration line when there
 * is no brace, capped so a wrapped signature cannot run away.
 */
export function signatureOf(
  project: string,
  node: ISamchonGraphNode,
): string | undefined {
  const evidence = node.evidence;
  const lines =
    evidence === undefined ? undefined : fileLines(project, evidence.file);
  if (lines === undefined || evidence === undefined) return undefined;
  const start = Math.max(0, evidence.startLine - 1);
  const out: string[] = [];
  for (
    let i = start;
    i < lines.length && out.length < MAX_SIGNATURE_LINES;
    i++
  ) {
    const line = lines[i];
    /* c8 ignore next */
    if (line === undefined) break;
    out.push(line);
    if (line.includes("{") || line.trimEnd().endsWith(";")) break;
  }
  const text = out.join("\n").trim();
  return text === "" ? undefined : text;
}
