import { TestValidator } from "@nestia/e2e";
import { spawnSync } from "node:child_process";

import { GraphPaths } from "../internal/GraphPaths";

export const test_cli_rejects_missing_option_values = () => {
  const result = spawnSync(process.execPath, [GraphPaths.graphBin, "dump", "--cwd"], {
    encoding: "utf8",
  });

  TestValidator.equals("missing option exits with failure", result.status, 1);
  TestValidator.predicate(
    "missing option prints package error",
    result.stderr.includes("@samchon/graph: Missing value for --cwd"),
  );
};
