import path from "node:path";

import typia from "typia";

import { IGraphDump } from "../structures";
import { IBuildGraphOptions } from "./IBuildGraphOptions";
import { buildLspGraph } from "./lspIndexer";
import { buildStaticGraph } from "./staticIndexer";

export async function buildGraphDump(
  options: IBuildGraphOptions = {},
): Promise<IGraphDump> {
  const normalized: IBuildGraphOptions = {
    ...options,
    cwd: path.resolve(options.cwd ?? process.cwd()),
    mode: options.mode ?? "auto",
  };
  if (normalized.mode === "static") {
    return validateDump(buildStaticGraph(normalized));
  }
  if (normalized.mode === "lsp") {
    return validateDump((await buildLspGraph(normalized)).dump);
  }
  return validateDump((await buildLspGraph(normalized)).dump);
}

function validateDump(dump: IGraphDump): IGraphDump {
  return typia.assert<IGraphDump>(dump);
}
