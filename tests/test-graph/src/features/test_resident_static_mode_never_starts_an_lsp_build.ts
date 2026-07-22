import { TestValidator } from "@nestia/e2e";
import fs from "node:fs";
import path from "node:path";

import { buildStaticGraphResult } from "../../../../packages/graph/src/indexer/buildStaticGraphResult";
import { createResidentGraphSource } from "../../../../packages/graph/src/indexer/createResidentGraphSource";
import { GraphPaths } from "../internal/GraphPaths";

export const test_resident_static_mode_never_starts_an_lsp_build = async () => {
  const root = GraphPaths.createTempDirectory("samchon-graph-resident-static-");
  const file = path.join(root, "answer.ts");
  const stable = "export const answer = 42;\n";
  fs.writeFileSync(file, stable);
  let lspBuilds = 0;
  let staticBuilds = 0;
  const resident = createResidentGraphSource(
    { cwd: root, mode: "static", languages: ["typescript"] },
    {
      buildLspGraph: async () => {
        lspBuilds += 1;
        throw new Error("static mode must not enter the LSP builder");
      },
      buildStaticGraphResult: (options) => {
        staticBuilds += 1;
        if (staticBuilds !== 1) return buildStaticGraphResult(options);
        // The manifest before and after this build is byte-identical, but the
        // parser consumed the transient middle. Comparing only those two
        // manifests would publish facts for source that no longer exists.
        fs.writeFileSync(file, "export const answer = 43;\n");
        const transient = buildStaticGraphResult(options);
        fs.writeFileSync(file, stable);
        return transient;
      },
    },
  );

  const dump = await resident.load();
  await resident.close();

  TestValidator.equals("resident static mode uses the static indexer", dump.indexer, "static");
  TestValidator.equals("resident static mode starts no LSP build", lspBuilds, 0);
  TestValidator.equals(
    "resident static mode retries a changed-then-reverted initial candidate",
    staticBuilds,
    2,
  );
};
