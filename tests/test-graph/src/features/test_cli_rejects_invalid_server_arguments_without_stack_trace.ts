import { TestValidator } from "@nestia/e2e";
import { spawnSync } from "node:child_process";

import { GraphPaths } from "../internal/GraphPaths";

export const test_cli_rejects_invalid_server_arguments_without_stack_trace = () => {
  const result = spawnSync(process.execPath, [GraphPaths.graphBin, "--mode", "invalid"], {
    encoding: "utf8",
  });

  TestValidator.equals("invalid CLI exits with failure", result.status, 1);
  TestValidator.predicate(
    "invalid CLI prints package error",
    result.stderr.includes("@samchon/graph: Invalid --mode: invalid"),
  );
  TestValidator.predicate("invalid CLI does not leak stack trace", !result.stderr.includes("\n    at "));
};
