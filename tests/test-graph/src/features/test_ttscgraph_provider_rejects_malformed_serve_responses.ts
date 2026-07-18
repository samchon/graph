import { TestValidator } from "@nestia/e2e";

// `TtscGraphClient` is internal to the package, so it is reached by path rather
// than through the public barrel.
import { TtscGraphClient } from "../../../../packages/graph/src/provider/ttscgraph/TtscGraphClient";
import { GraphPaths } from "../internal/GraphPaths";

/**
 * The NDJSON serve protocol is untrusted input. Every malformed frame, invalid
 * response shape, and contradictory state transition must fail the refresh
 * loudly and leave the client with no snapshot and generation zero — never a
 * silently empty success.
 */
export const test_ttscgraph_provider_rejects_malformed_serve_responses =
  async () => {
    const root = GraphPaths.createTempDirectory("samchon-graph-ttscgraph-bad-");

    // Stream-framing faults: the client parses NDJSON itself, so each of these
    // is surfaced as an error rather than resolving a request.
    await assertRejected(root, "invalid-json", "a non-JSON serve line");
    await assertRejected(root, "non-object", "a non-object JSON response");
    await assertRejected(root, "missing-id", "a response without a valid id");
    await assertRejected(root, "unknown-id", "a response with an unsolicited id");

    // Response-shape faults: the discriminant and its metadata must be typed.
    await assertRejected(root, "changed-not-boolean", "a non-boolean changed flag");
    await assertRejected(root, "error-not-string", "a non-string error field");
    await assertRejected(root, "mode-not-string", "a non-string mode field");

    // State-transition faults: a first unchanged has nothing to reuse, a changed
    // response must carry its dump, and an unchanged response must not carry one.
    await assertRejected(
      root,
      "unchanged-first",
      "a first unchanged response with no prior snapshot",
    );
    await assertRejected(
      root,
      "changed-no-dump",
      "a changed response that omitted its dump",
    );
    await assertRejected(
      root,
      "unchanged-with-dump",
      "an unchanged response that carried a dump",
    );
  };

async function assertRejected(
  root: string,
  serveCase: string,
  label: string,
): Promise<void> {
  const client = new TtscGraphClient({
    root,
    command: process.execPath,
    args: [GraphPaths.fakeTtscGraphServer, `--serve=${serveCase}`],
  });
  try {
    let error: unknown;
    try {
      await client.refresh();
    } catch (caught) {
      error = caught;
    }
    TestValidator.predicate(`${label} fails the refresh`, error instanceof Error);
    TestValidator.predicate(
      `${label} publishes no snapshot`,
      client.current === undefined && client.generation === 0,
    );
  } finally {
    await client.close();
  }
}
