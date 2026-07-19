import { TestValidator } from "@nestia/e2e";
import fs from "node:fs";
import path from "node:path";

import { TtscGraphClient } from "../../../../packages/graph/src/provider/ttscgraph/TtscGraphClient";
import { GraphPaths } from "../internal/GraphPaths";

/** A stalled request owns one child generation, never the resident queue. */
export const test_ttscgraph_native_requests_recover_from_stalls = async () => {
  const root = fixture();
  const marker = path.join(root, "first-child.txt");
  const client = create(root, marker, 300);
  try {
    const first = client.refresh();
    const queued = client.refresh();
    const error = await rejectionOf(first);
    TestValidator.predicate(
      "a silent native request times out precisely",
      error.message.includes("timed out after 300 ms"),
    );
    const recovered = await queued;
    TestValidator.equals(
      "a queued refresh restarts on a fresh child",
      recovered.generation,
      1,
    );
    TestValidator.predicate(
      "the timed-out snapshot is not retained",
      recovered.snapshot.nodes.some((node) => node.name === "first"),
    );
  } finally {
    await client.close();
  }

  const closeRoot = fixture();
  const closeClient = create(
    closeRoot,
    path.join(closeRoot, "first-child.txt"),
    5_000,
  );
  const stalled = closeClient.refresh();
  await delay(100);
  const closed = await Promise.race([
    Promise.allSettled([stalled, closeClient.close()]),
    delay(1_000).then(() => "timeout" as const),
  ]);
  TestValidator.predicate(
    "close settles without queueing behind a stalled refresh",
    closed !== "timeout" && closed[0]?.status === "rejected",
  );

  const abortRoot = fixture();
  const abortClient = create(
    abortRoot,
    path.join(abortRoot, "first-child.txt"),
    5_000,
  );
  try {
    const controller = new AbortController();
    const aborted = abortClient.refresh({ signal: controller.signal });
    await delay(100);
    controller.abort("test cancellation");
    const error = await rejectionOf(aborted);
    TestValidator.predicate(
      "abort retires its exact child generation",
      error.name === "AbortError" && error.message.includes("test cancellation"),
    );
    TestValidator.equals(
      "the next refresh recovers after abort",
      (await abortClient.refresh()).generation,
      1,
    );
  } finally {
    await abortClient.close();
  }

  for (const value of [0, -1, 1.5, Number.NaN, 2_147_483_648]) {
    let error: unknown;
    try {
      new TtscGraphClient({
        root,
        command: process.execPath,
        args: [GraphPaths.fakeTtscGraphServer],
        requestTimeoutMs: value,
      });
    } catch (caught) {
      error = caught;
    }
    TestValidator.predicate(
      `unsafe timeout ${String(value)} is rejected before spawn`,
      error instanceof TypeError,
    );
  }
};

const create = (
  root: string,
  marker: string,
  requestTimeoutMs: number,
): TtscGraphClient =>
  new TtscGraphClient({
    root,
    command: process.execPath,
    args: [
      GraphPaths.fakeTtscGraphServer,
      `--ignore-first-process=${marker}`,
    ],
    requestTimeoutMs,
  });

const fixture = (): string => {
  const root = GraphPaths.createTempDirectory(
    "samchon-graph-ttscgraph-timeout-",
  );
  fs.mkdirSync(path.join(root, "src", "core"), { recursive: true });
  fs.writeFileSync(path.join(root, "tsconfig.json"), "{}\n");
  fs.writeFileSync(path.join(root, "src", "index.ts"), "export * from './core/order';\n");
  fs.writeFileSync(path.join(root, "src", "core", "order.ts"), "export function first() {}\n");
  fs.writeFileSync(path.join(root, "src", "empty.ts"), "export {};\n");
  return root;
};

const rejectionOf = async (promise: Promise<unknown>): Promise<Error> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error("expected promise to reject");
};

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
