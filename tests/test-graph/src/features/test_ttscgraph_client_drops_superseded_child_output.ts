import { TestValidator } from "@nestia/e2e";
import path from "node:path";

// `TtscGraphClient` is internal to the package, so it is reached by path rather
// than the public entry.
import { TtscGraphClient } from "../../../../packages/graph/src/provider/ttscgraph/TtscGraphClient";
import { GraphPaths } from "../internal/GraphPaths";

/**
 * A stdout chunk delivered for a child the client no longer references is
 * dropped rather than folded into the live session's line buffer.
 *
 * `consume` is bound to the exact child whose stream produced it, so a buffered
 * read that lands after a restart or a failure — when `this.child` has moved on
 * or been cleared — must be ignored. Nothing is spawned: the guard is exercised
 * directly against a superseded child while the client owns none, which is the
 * one-input reduction of that otherwise timing-dependent race.
 */
export const test_ttscgraph_client_drops_superseded_child_output = async () => {
  const root = GraphPaths.createTempDirectory("samchon-graph-superseded-child-");
  const client = new TtscGraphClient({
    root,
    command: path.join(root, "unused-ttscgraph-binary"),
  });
  try {
    const superseded = { stdoutChunks: [] as string[] };
    (
      client as unknown as { consume(child: unknown, chunk: string): void }
    ).consume(superseded, "superseded serve line\n");
    TestValidator.equals(
      "a superseded child's output is dropped",
      superseded.stdoutChunks,
      [],
    );
    TestValidator.predicate(
      "and the client still owns no session",
      client.current === undefined && client.generation === 0,
    );
  } finally {
    await client.close();
  }
};
