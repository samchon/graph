import path from "node:path";

import { IGraphNode } from "../structures";
import { readLines } from "../utils/fs";

export function signatureOf(project: string, node: IGraphNode): string | undefined {
  if (node.signature !== undefined && node.signature.trim() !== "") {
    return compactSignature(node.signature);
  }
  if (node.evidence === undefined || node.file === "") return undefined;
  const lines = readLines(path.join(project, node.evidence.file));
  if (lines === undefined) return undefined;
  const start = Math.max(0, node.evidence.startLine - 1);
  const end =
    node.evidence.endLine === undefined
      ? Math.min(lines.length, start + 4)
      : Math.min(lines.length, node.evidence.endLine);
  const out: string[] = [];
  for (let i = start; i < end && out.length < 4; i++) {
    const line = lines[i];
    /* c8 ignore next */
    if (line === undefined) break;
    out.push(line);
    const trimmed = line.trimEnd();
    if (trimmed.endsWith(";") || trimmed.endsWith("{") || trimmed.endsWith("}")) {
      break;
    }
  }
  const text = out.join("\n").trim();
  return text === "" ? undefined : compactSignature(text);
}

function compactSignature(text: string): string {
  return text
    .split(/\r?\n/)
    .slice(0, 4)
    .join("\n")
    .replace(/\s+$/gm, "")
    .trim();
}
