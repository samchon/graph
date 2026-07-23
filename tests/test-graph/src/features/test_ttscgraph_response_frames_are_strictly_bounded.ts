import { TestValidator } from "@nestia/e2e";
import path from "node:path";

import { TtscGraphClient } from "../../../../packages/graph/src/provider/ttscgraph/TtscGraphClient";
import { GraphPaths } from "../internal/GraphPaths";

/** A native producer cannot retain an unbounded partial or complete NDJSON frame. */
export const test_ttscgraph_response_frames_are_strictly_bounded =
  async () => {
    const root = GraphPaths.createTempDirectory("graph-ttsc-frame-limit-");
    TestValidator.error("zero native response bounds are refused", () =>
      new TtscGraphClient({
        root,
        command: process.execPath,
        maxResponseBytes: 0,
      }),
    );
    TestValidator.error("fractional native response bounds are refused", () =>
      new TtscGraphClient({
        root,
        command: process.execPath,
        maxResponseBytes: 1.5,
      }),
    );

    for (const mode of ["unterminated", "terminated"] as const) {
      const client = new TtscGraphClient({
        root,
        command: process.execPath,
        args: [
          GraphPaths.fakeTtscGraphServer,
          "--cwd",
          path.resolve(root),
          `--oversized-response=${mode}`,
        ],
        maxResponseBytes: 128,
      });
      try {
        let failure: Error | undefined;
        await client
          .refresh()
          .catch((error: Error) => void (failure = error));
        TestValidator.predicate(
          `an ${mode} oversized native frame retires its child`,
          failure?.message.includes("frame limit") === true,
        );
      } finally {
        await client.close();
      }
    }
  };
