import { ISamchonGraphNode } from "../structures";
import { fileLines } from "./fileLines";

// A doc summary is one sentence; the rest of the comment is the file's to keep.
const MAX_DOC_CHARS = 200;

/**
 * What the declaration says it is: the first sentence of the doc comment
 * written above it.
 *
 * A tour hands back names, edges, spans, and signatures, and a model given them
 * still opens the files — "let me read the actual source at the key hops to
 * build a concrete narrative" — because a name and an arrow do not say what a
 * symbol is for, and a tour is a narrative. The project already wrote that
 * sentence above the declaration, and the indexer carries it. It is the
 * declaration's documentation, not the body of the work: an index that lists a
 * symbol with what it is for is doing an index's job.
 */
export function docOf(
  project: string,
  node: ISamchonGraphNode,
): string | undefined {
  const evidence = node.evidence;
  const lines =
    evidence === undefined ? undefined : fileLines(project, evidence.file);
  if (lines === undefined || evidence === undefined) return undefined;
  let index = evidence.startLine - 2;
  while (index >= 0 && (lines[index] ?? "").trim() === "") index--;
  if (index < 0 || !(lines[index] ?? "").trim().endsWith("*/"))
    return undefined;
  const block: string[] = [];
  for (; index >= 0; index--) {
    const line = (lines[index] ?? "").trim();
    block.unshift(line);
    if (line.startsWith("/**")) break;
    if (line.startsWith("/*")) return undefined;
  }
  if (index < 0) return undefined;
  const prose: string[] = [];
  for (const line of block) {
    const text = line
      .replace(/^\/\*\*+/, "")
      .replace(/\*\/$/, "")
      .replace(/^\*+ ?/, "")
      .trim();
    if (text.startsWith("@")) break;
    if (text !== "") prose.push(text);
  }
  const joined = prose.join(" ").trim();
  if (joined === "") return undefined;
  const stop = joined.search(/\.(\s|$)/);
  const sentence = stop > 0 ? joined.slice(0, stop + 1) : joined;
  return sentence.length > MAX_DOC_CHARS
    ? sentence.slice(0, MAX_DOC_CHARS).trimEnd() + "…"
    : sentence;
}
