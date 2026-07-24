import { ChildProcess } from "node:child_process";

import { windowsJobObject } from "./windowsJobObject";

const TERMINATION_GRACE_MS = 250;
const FORCED_EXIT_GRACE_MS = 2_000;
const WINDOWS_JOBS = new WeakMap<ChildProcess, windowsJobObject.IJob>();

export namespace ownedProcess {
  export interface ICommand {
    command: string;
    args: string[];
    windowsVerbatimArguments?: boolean;
  }

  /** Spawn setting that gives one POSIX command an addressable process group. */
  export function group(): boolean {
    return process.platform !== "win32";
  }

  /**
   * Put one command behind the platform's exact process-tree boundary.
   *
   * POSIX addresses the command's detached process group directly. Windows
   * assigns the exact spawned process to a private Job Object through the
   * native Win32 API; every descendant then inherits that ownership.
   */
  export function command(
    command: string,
    args: readonly string[],
    windowsVerbatimArguments?: boolean,
  ): ICommand {
    /* c8 ignore start -- prepare the native API before a Windows child can run
     * so the post-spawn assignment window contains no module initialization. */
    if (process.platform === "win32") windowsJobObject.prepare();
    /* c8 ignore stop */
    return {
      command,
      args: [...args],
      windowsVerbatimArguments,
    };
  }

  /**
   * Assign a just-spawned Windows process to its exact native ownership set.
   *
   * The native API is already loaded by {@link command}, so this happens
   * synchronously in the same turn as `spawn()` without an interpreter or
   * module initialization in between. The command keeps its original
   * CreateProcess length budget.
   */
  export function start(child: ChildProcess): void {
    /* c8 ignore start -- Windows-only native Job Object attachment. */
    if (process.platform !== "win32") return;
    let job: windowsJobObject.IJob | undefined;
    try {
      // Node reports a missing executable asynchronously with no PID. There is
      // no process tree to own in that state; leave its already-scheduled
      // `error` event to the transport's ordinary failure listener.
      if (child.pid === undefined) return;
      job = windowsJobObject.create(child.pid);
      WINDOWS_JOBS.set(child, job);
    } catch (error) {
      if (job !== undefined) windowsJobObject.close(job);
      try {
        child.kill("SIGKILL");
      } catch {
        // The failed child may already have retired.
      }
      throw error;
    }
    /* c8 ignore stop */
  }

  /** Wait for the exact child and retire every process its Job still owns. */
  export function exit(child: ChildProcess): Promise<void> {
    return new Promise((resolve, reject) => {
      const settled = (): void => {
        child.off("error", settled);
        child.off("exit", settled);
        child.off("close", settled);
        const job = WINDOWS_JOBS.get(child);
        if (job === undefined) {
          resolve();
          return;
        }
        WINDOWS_JOBS.delete(child);
        void windowsJobObject.retire(job).then(resolve).catch(reject);
      };
      child.once("error", settled);
      child.once("exit", settled);
      child.once("close", settled);
    });
  }

  /**
   * Retire the exact process tree rooted at a child created by
   * {@link command}. Unrelated processes are never enumerated or signalled.
   */
  export async function terminate(
    child: ChildProcess,
    exit: Promise<void>,
    owner: string,
    options: { cooperativeStdin?: boolean } = {},
  ): Promise<void> {
    // Give a cooperative transport one bounded chance to observe EOF, flush
    // its final bookkeeping, and retire its own descendants. Destroying stdin
    // and signalling the process group in the same turn races readline's close
    // handler on POSIX and makes an orderly shutdown platform-dependent.
    if (
      options.cooperativeStdin === true &&
      child.stdin !== null &&
      !child.stdin.destroyed
    ) {
      child.stdin.end();
      if (await waitForOwnedTreeExit(child, exit, TERMINATION_GRACE_MS)) {
        await exit;
        return;
      }
    }
    if (
      !isRunning(child) &&
      /* c8 ignore next -- only one platform arm runs on a coverage host. */
      (process.platform === "win32" || !isOwnedProcessGroupRunning(child))
    ) {
      await exit;
      return;
    }
    /* c8 ignore start -- one OS lane runs on each coverage host; platform
     * lifecycle tests exercise both implementations. */
    if (process.platform === "win32") {
      const job = WINDOWS_JOBS.get(child);
      if (job !== undefined) windowsJobObject.terminate(job);
      else child.kill("SIGKILL");
      if (await waitForExit(exit, FORCED_EXIT_GRACE_MS)) {
        await exit;
        return;
      }
      throw new Error(
        `${owner}: owned process tree did not exit after forced termination`,
      );
    }
    signalOwnedProcessGroup(child, "SIGTERM");
    if (await waitForOwnedTreeExit(child, exit, TERMINATION_GRACE_MS)) {
      await exit;
      return;
    }
    signalOwnedProcessGroup(child, "SIGKILL");
    if (!(await waitForOwnedTreeExit(child, exit, FORCED_EXIT_GRACE_MS))) {
      throw new Error(
        `${owner}: owned process tree did not exit after forced termination`,
      );
    }
    await exit;
  }
  /* c8 ignore stop */
}

function isRunning(child: ChildProcess): boolean {
  return (
    child.pid !== undefined &&
    child.exitCode === null &&
    child.signalCode === null
  );
}

/* c8 ignore start -- POSIX-only process-group liveness probe. */
function isOwnedProcessGroupRunning(child: ChildProcess): boolean {
  if (process.platform === "win32" || child.pid === undefined) return false;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
/* c8 ignore stop */

/* c8 ignore start -- POSIX-only fixed-signal process-group helper. */
function signalOwnedProcessGroup(
  child: ChildProcess,
  signal: NodeJS.Signals,
): void {
  try {
    process.kill(-child.pid!, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      return;
    }
  }
}
/* c8 ignore stop */

/* c8 ignore start -- Windows-only exact child wait. POSIX waits for both the
 * child and its process group in waitForOwnedTreeExit below. */
function waitForExit(exit: Promise<void>, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean): void => {
      /* c8 ignore next -- child exit and its deadline may race. */
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref();
    void exit
      .then(() => finish(true))
      .catch(() => finish(true));
  });
}
/* c8 ignore stop */

/**
 * A POSIX process group can outlive its leader. Waiting for the child handle
 * alone would report success as soon as the leader exits even when a descendant
 * ignored SIGTERM, so forced termination must wait for both facts.
 */
/* c8 ignore start -- POSIX-only process-group polling; lifecycle integration
 * exercises it on Linux and macOS while Windows uses a Job Object. */
async function waitForOwnedTreeExit(
  child: ChildProcess,
  exit: Promise<void>,
  timeoutMs: number,
): Promise<boolean> {
  if (process.platform === "win32") return waitForExit(exit, timeoutMs);
  let rootExited = false;
  void exit.then(() => {
    rootExited = true;
  });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (rootExited && !isOwnedProcessGroupRunning(child)) return true;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    // Keep this bounded cleanup alive after the group leader has exited. An
    // unref'd timer plus an orphaned detached descendant could let Node quit
    // before the promised process-tree cleanup finishes.
    await new Promise<undefined>((resolve) => {
      setTimeout(() => resolve(undefined), Math.min(25, remaining));
    });
  }
}
/* c8 ignore stop */
