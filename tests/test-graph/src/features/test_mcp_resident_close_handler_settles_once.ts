import { TestValidator } from "@nestia/e2e";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { GraphPaths } from "../internal/GraphPaths";

export const test_mcp_resident_close_handler_settles_once = async () => {
  const module = (await import(
    pathToFileURL(
      path.join(
        GraphPaths.graphPackageRoot,
        "lib",
        "mcp",
        "startServer.js",
      ),
    ).href
  )) as {
    createResidentCloseHandler(
      resident: { close(): Promise<void> },
      report: (error: unknown) => void,
    ): () => Promise<void>;
  };
  const failure = new Error("resident close failed");
  const reports: unknown[] = [];
  let closes = 0;
  const close = module.createResidentCloseHandler(
    {
      close(): Promise<void> {
        closes += 1;
        return Promise.reject(failure);
      },
    },
    (error) => reports.push(error),
  );

  const fromTransport = close();
  const fromStdin = close();
  TestValidator.predicate(
    "transport close and stdin end share one shutdown promise",
    fromTransport === fromStdin,
  );
  await fromTransport;
  await fromStdin;
  TestValidator.equals("the resident closes once", closes, 1);
  TestValidator.equals(
    "the contained close failure is reported once",
    reports,
    [failure],
  );
};
