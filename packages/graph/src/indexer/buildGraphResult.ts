import path from "node:path";

import { buildLspGraph } from "./buildLspGraph";
import { buildStaticGraphResult } from "./buildStaticGraphResult";
import { IBuildGraphOptions } from "./IBuildGraphOptions";
import { IIndexerResult } from "./IIndexerResult";
import { parseGraphDump } from "./parseGraphDump";

/** Internal one-shot result that keeps source evidence beside its dump. */
export async function buildGraphResult(
  options: IBuildGraphOptions = {},
): Promise<IIndexerResult> {
  const normalized: IBuildGraphOptions = {
    ...options,
    cwd: path.resolve(options.cwd ?? process.cwd()),
    mode: options.mode ?? "auto",
  };
  const result =
    normalized.mode === "static"
      ? buildStaticGraphResult(normalized)
      : await buildLspGraph(normalized);
  return { ...result, dump: parseGraphDump(result.dump) };
}
