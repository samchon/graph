import { TestValidator } from "@nestia/e2e";
import fs from "node:fs";
import path from "node:path";

// `TtscGraphClient` is internal to the package, so it is reached by path rather
// than through the public barrel.
import { TtscGraphClient } from "../../../../packages/graph/src/provider/ttscgraph/TtscGraphClient";
import { GraphPaths } from "../internal/GraphPaths";

/**
 * A resident strict session must always tell the truth about its child process:
 * a process that cannot start, crashes, or refuses to stop is surfaced as an
 * error and cleaned up, never hidden behind a silent empty graph.
 */
export const test_ttscgraph_provider_surfaces_process_failures = async () => {
  const root = GraphPaths.createTempDirectory("samchon-graph-ttscgraph-fail-");

  // A command that cannot be spawned rejects the refresh instead of hanging or
  // returning an empty snapshot, and publishes no generation.
  const unspawnable = new TtscGraphClient({
    root,
    command: path.join(root, "no-such-ttscgraph-binary"),
  });
  await rejects(
    unspawnable.refresh(),
    "an unspawnable command surfaces an error",
  );
  TestValidator.predicate(
    "an unspawnable command publishes no snapshot",
    unspawnable.current === undefined && unspawnable.generation === 0,
  );

  // A process that writes diagnostics and then exits mid-request surfaces those
  // diagnostics verbatim, and a later refresh keeps reporting the dead process.
  const dying = new TtscGraphClient({
    root,
    command: process.execPath,
    args: [GraphPaths.fakeTtscGraphServer, "--stderr-exit"],
  });
  await delay(200);
  let crash: unknown;
  try {
    await dying.refresh();
  } catch (error) {
    crash = error;
  }
  TestValidator.predicate(
    "a crashed serve process surfaces its stderr diagnostics",
    crash instanceof Error && crash.message.includes("ttscgraph diagnostic: fatal"),
  );
  TestValidator.predicate(
    "a crash leaves no snapshot and no generation",
    dying.current === undefined && dying.generation === 0,
  );
  await rejects(
    dying.refresh(),
    "a refresh after the process exited reports it is gone",
  );
  // The child already exited, so close resolves immediately without touching it.
  await dying.close();

  // A process that exits without diagnostics still rejects, and a later refresh
  // reports the process is gone without inventing an empty snapshot.
  const silent = new TtscGraphClient({
    root,
    command: process.execPath,
    args: [GraphPaths.fakeTtscGraphServer, "--exit-silently"],
  });
  await rejects(silent.refresh(), "a silently exiting process rejects the refresh");
  await rejects(
    silent.refresh(),
    "a refresh after a silent exit reports the process is not running",
  );
  await silent.close();

  // A closed session refuses further refreshes, and close is idempotent.
  const closed = new TtscGraphClient({
    root,
    command: process.execPath,
    args: [GraphPaths.fakeTtscGraphServer],
  });
  const firstClose = closed.close();
  const secondClose = closed.close();
  TestValidator.equals(
    "close is idempotent and returns the same in-flight promise",
    firstClose === secondClose,
    true,
  );
  await firstClose;
  await rejects(
    closed.refresh(),
    "a refresh after close reports the session is closed",
  );

  // A process that ignores its stdin closing is force-killed after the graceful
  // window, and only that exact owned child is ended.
  const marker = path.join(root, "stubborn-closed.txt");
  const stubborn = new TtscGraphClient({
    root,
    command: process.execPath,
    args: [
      GraphPaths.fakeTtscGraphServer,
      "--ignore-stdin",
      `--marker=${marker}`,
    ],
  });
  await stubborn.close();
  TestValidator.equals(
    "closing a stubborn child still ends the exact owned process",
    fs.readFileSync(marker, "utf8"),
    "closed\n",
  );
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rejects(task: Promise<unknown>, label: string): Promise<void> {
  let error: unknown;
  try {
    await task;
  } catch (caught) {
    error = caught;
  }
  TestValidator.predicate(label, error instanceof Error);
}
