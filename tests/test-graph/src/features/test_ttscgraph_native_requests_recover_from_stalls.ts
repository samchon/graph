import { TestValidator } from "@nestia/e2e";
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { TtscGraphClient } from "../../../../packages/graph/src/provider/ttscgraph/TtscGraphClient";
import { GraphPaths } from "../internal/GraphPaths";

/** A stalled request owns one child generation, never the resident queue. */
export const test_ttscgraph_native_requests_recover_from_stalls = async () => {
  const root = fixture();
  const marker = path.join(root, "first-child.txt");
  const client = create(root, marker, 1_000);
  try {
    const first = client.refresh();
    const queued = client.refresh();
    const error = await rejectionOf(first);
    TestValidator.predicate(
      "a silent native request times out precisely",
      error.message.includes("timed out after 1000 ms"),
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
  const closeRequestLog = path.join(closeRoot, "close-request.txt");
  const closeClient = create(
    closeRoot,
    path.join(closeRoot, "first-child.txt"),
    5_000,
    closeRequestLog,
  );
  const stalled = closeClient.refresh();
  await waitForFile(closeRequestLog);
  const closed = await Promise.race([
    Promise.allSettled([stalled, closeClient.close()]),
    delay(1_000).then(() => "timeout" as const),
  ]);
  TestValidator.predicate(
    "close settles without queueing behind a stalled refresh",
    closed !== "timeout" && closed[0]?.status === "rejected",
  );

  /* c8 ignore next -- Windows terminates child processes unconditionally. */
  if (process.platform !== "win32") {
    await assertRetiredChildIsClosed();
  }

  const abortRoot = fixture();
  const abortRequestLog = path.join(abortRoot, "abort-request.txt");
  const abortClient = create(
    abortRoot,
    path.join(abortRoot, "first-child.txt"),
    5_000,
    abortRequestLog,
  );
  try {
    const controller = new AbortController();
    const aborted = abortClient.refresh({ signal: controller.signal });
    await waitForFile(abortRequestLog);
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
  requestLog?: string,
): TtscGraphClient =>
  new TtscGraphClient({
    root,
    command: process.execPath,
    args: [
      GraphPaths.fakeTtscGraphServer,
      `--ignore-first-process=${marker}`,
      ...(requestLog === undefined ? [] : [`--request-log=${requestLog}`]),
    ],
    requestTimeoutMs,
  });

/** A detached generation remains owned until its SIGKILL fallback exits. */
const assertRetiredChildIsClosed = async (): Promise<void> => {
  const root = fixture();
  const started = path.join(root, "retired-child.txt");
  const requested = path.join(root, "retired-request.txt");
  const terminated = path.join(root, "retired-sigterm.txt");
  const unrelatedStarted = path.join(root, "unrelated-child.txt");
  const childSource = [
    'const fs = require("node:fs");',
    'const readline = require("node:readline");',
    `fs.writeFileSync(${JSON.stringify(started)}, String(process.pid));`,
    "readline.createInterface({ input: process.stdin }).once(\"line\", () =>",
    `  fs.writeFileSync(${JSON.stringify(requested)}, "request\\n"));`,
    "process.on(\"SIGTERM\", () =>",
    `  fs.writeFileSync(${JSON.stringify(terminated)}, "sigterm\\n"));`,
    "setInterval(() => undefined, 1_000);",
  ].join("\n");
  const client = new TtscGraphClient({
    root,
    command: process.execPath,
    args: ["-e", childSource],
    requestTimeoutMs: 5_000,
  });
  const unrelated = spawn(
    process.execPath,
    [
      "-e",
      [
        'const fs = require("node:fs");',
        `fs.writeFileSync(${JSON.stringify(unrelatedStarted)}, String(process.pid));`,
        "setInterval(() => undefined, 1_000);",
      ].join("\n"),
    ],
    { stdio: "ignore", windowsHide: true },
  );
  try {
    await waitForFile(unrelatedStarted);
    const controller = new AbortController();
    const stalled = client.refresh({ signal: controller.signal });
    await waitForFile(requested);
    const pid = Number(fs.readFileSync(started, "utf8"));
    controller.abort("retire stubborn generation");
    await rejectionOf(stalled);
    await waitForFile(terminated);

    const firstClose = client.close();
    const secondClose = client.close();
    TestValidator.equals(
      "retired-generation close remains idempotent",
      firstClose === secondClose,
      true,
    );
    const closed = await Promise.race([
      firstClose.then(() => "closed" as const),
      delay(3_000).then(() => "timeout" as const),
    ]);
    TestValidator.equals(
      "close awaits the retired child's SIGKILL fallback",
      closed,
      "closed",
    );
    TestValidator.equals(
      "close returns only after the retired child exits",
      isProcessAlive(pid),
      false,
    );
    TestValidator.equals(
      "close does not terminate an unrelated Node process",
      isProcessAlive(unrelated.pid!),
      true,
    );
  } finally {
    await Promise.allSettled([client.close(), stop(unrelated)]);
  }
};

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

const waitForFile = async (file: string): Promise<void> => {
  const deadline = Date.now() + 5_000;
  while (!fs.existsSync(file)) {
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for ${file}`);
    }
    await delay(10);
  }
};

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const stop = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
  });
  child.kill("SIGKILL");
  await exited;
};
