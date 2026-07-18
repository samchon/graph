import { TestValidator } from "@nestia/e2e";
import fs from "node:fs";
import path from "node:path";

// `TtscGraphClient` is internal to the package, so it is reached by path rather
// than through the public barrel.
import { TtscGraphClient } from "../../../../packages/graph/src/provider/ttscgraph/TtscGraphClient";
import { GraphPaths } from "../internal/GraphPaths";

/**
 * A resident strict session must reassemble the NDJSON stream regardless of how
 * it is chunked, re-adapt the newer generation when the compiler edits again
 * mid-encode, and abort cleanly when the confirming poll fails — all without
 * corrupting the published snapshot.
 */
export const test_ttscgraph_provider_reindexes_and_reassembles_streams =
  async () => {
    const root = GraphPaths.createTempDirectory("samchon-graph-ttscgraph-stream-");
    fs.mkdirSync(path.join(root, "src", "core"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "index.ts"), "export * from './core/order';\n");
    fs.writeFileSync(path.join(root, "src", "core", "order.ts"), "export async function first() {}\n");
    fs.writeFileSync(path.join(root, "src", "empty.ts"), "export {};\n");

    // A blank NDJSON line before a valid frame is ignored, not treated as a
    // response.
    const blank = await refreshOnce(root, "blank-line");
    TestValidator.predicate(
      "a blank NDJSON line is ignored and the real frame still applies",
      blank.changed && blank.generation === 1 && blank.snapshot.nodes[0]?.name === "first",
    );

    // A frame split across stream chunks is reassembled before parsing.
    const split = await refreshOnce(root, "split-frame");
    TestValidator.predicate(
      "a frame split across stream chunks is reassembled",
      split.changed && split.generation === 1 && split.snapshot.nodes[0]?.name === "first",
    );

    // When the compiler produces another full dump while the first is being
    // confirmed, the client adapts the newer generation, not the stale one.
    const concurrent = await refreshOnce(root, "confirm-changed");
    TestValidator.predicate(
      "a concurrent edit during confirmation adapts the newer generation",
      concurrent.changed &&
        concurrent.generation === 1 &&
        concurrent.snapshot.nodes[0]?.name === "second",
    );

    // A confirming poll that returns an error aborts the refresh and publishes
    // nothing, leaving the client at generation zero.
    const failing = new TtscGraphClient({
      root,
      command: process.execPath,
      args: [GraphPaths.fakeTtscGraphServer, "--serve=confirm-error"],
    });
    try {
      let error: unknown;
      try {
        await failing.refresh();
      } catch (caught) {
        error = caught;
      }
      TestValidator.predicate(
        "a failed confirming poll aborts the refresh",
        error instanceof Error,
      );
      TestValidator.predicate(
        "a failed confirming poll publishes no snapshot",
        failing.current === undefined && failing.generation === 0,
      );
    } finally {
      await failing.close();
    }
  };

async function refreshOnce(
  root: string,
  serveCase: string,
): Promise<{
  changed: boolean;
  generation: number;
  snapshot: { nodes: { name: string }[] };
}> {
  const client = new TtscGraphClient({
    root,
    command: process.execPath,
    args: [GraphPaths.fakeTtscGraphServer, `--serve=${serveCase}`],
  });
  try {
    return await client.refresh();
  } finally {
    await client.close();
  }
}
