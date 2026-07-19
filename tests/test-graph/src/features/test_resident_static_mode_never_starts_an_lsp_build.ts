import { TestValidator } from "@nestia/e2e";
import fs from "node:fs";
import path from "node:path";

import { createResidentGraphSource } from "../../../../packages/graph/src/indexer/createResidentGraphSource";
import { GraphPaths } from "../internal/GraphPaths";

export const test_resident_static_mode_never_starts_an_lsp_build = async () => {
  const root = GraphPaths.createTempDirectory("samchon-graph-resident-static-");
  fs.writeFileSync(
    path.join(root, "answer.ts"),
    "export const answer = 42;\n",
  );
  let lspBuilds = 0;
  const resident = createResidentGraphSource(
    { cwd: root, mode: "static", languages: ["typescript"] },
    {
      buildLspGraph: async () => {
        lspBuilds += 1;
        throw new Error("static mode must not enter the LSP builder");
      },
    },
  );

  const dump = await resident.load();
  await resident.close();

  TestValidator.equals("resident static mode uses the static indexer", dump.indexer, "static");
  TestValidator.equals("resident static mode starts no LSP build", lspBuilds, 0);
};
