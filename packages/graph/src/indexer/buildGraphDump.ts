import path from "node:path";
import typia from "typia";
import { ISamchonGraphDump } from "../structures";
import { IBuildGraphOptions } from "./IBuildGraphOptions";
import { buildLspGraph } from "./buildLspGraph";
import { buildStaticGraph } from "./buildStaticGraph";

export async function buildGraphDump(
  options: IBuildGraphOptions = {},
): Promise<ISamchonGraphDump> {
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

function validateDump(dump: ISamchonGraphDump): ISamchonGraphDump {
  return typia.assert<ISamchonGraphDump>(dump);
}
