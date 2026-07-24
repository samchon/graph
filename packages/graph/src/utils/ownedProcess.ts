import { ChildProcess, spawn } from "node:child_process";
import path from "node:path";

const TERMINATION_GRACE_MS = 250;
const FORCED_EXIT_GRACE_MS = 2_000;

export namespace ownedProcess {
  /**
   * Spawn setting that gives one graph-owned command an addressable POSIX
   * process group. Windows tree ownership is enforced by `taskkill /T`.
   */
  export function group(): boolean {
    return process.platform !== "win32";
  }

  /** Wait for an exact child handle, without searching the PID table. */
  export function exit(child: ChildProcess): Promise<void> {
    return new Promise((resolve) => {
      const settled = (): void => {
        child.off("error", settled);
        child.off("exit", settled);
        child.off("close", settled);
        resolve();
      };
      child.once("error", settled);
      child.once("exit", settled);
      child.once("close", settled);
    });
  }

  /**
   * Retire the exact process tree rooted at a child spawned with
   * {@link group}. Unrelated processes are never enumerated or signalled.
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
        return;
      }
    }
    if (
      !isRunning(child) &&
      /* c8 ignore next -- only one platform arm runs on a coverage host. */
      (process.platform === "win32" || !isOwnedProcessGroupRunning(child))
    ) {
      return;
    }
    /* c8 ignore start -- one OS lane runs on each coverage host; platform
     * lifecycle tests exercise both implementations. */
    if (process.platform === "win32") {
      await killWindowsProcessTree(child.pid!);
      if (await waitForExit(exit, FORCED_EXIT_GRACE_MS)) return;
      throw new Error(
        `${owner}: owned process tree did not exit after forced termination`,
      );
    }
    signalOwnedProcessGroup(child, "SIGTERM");
    if (await waitForOwnedTreeExit(child, exit, TERMINATION_GRACE_MS)) return;
    signalOwnedProcessGroup(child, "SIGKILL");
    if (!(await waitForOwnedTreeExit(child, exit, FORCED_EXIT_GRACE_MS))) {
      throw new Error(
        `${owner}: owned process tree did not exit after forced termination`,
      );
    }
    /* c8 ignore stop */
  }
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

/* c8 ignore start -- Windows-only exact process-tree helper. */
function killWindowsProcessTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    const killer = spawn(
      path.join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32",
        "taskkill.exe",
      ),
      ["/pid", String(pid), "/t", "/f"],
      {
        stdio: "ignore",
        windowsHide: true,
      },
    );
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      killer.kill();
      finish();
    }, FORCED_EXIT_GRACE_MS);
    timer.unref();
    killer.once("error", finish);
    killer.once("exit", finish);
  });
}
/* c8 ignore stop */

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
    void exit.then(() => finish(true));
  });
}

/**
 * A POSIX process group can outlive its leader. Waiting for the child handle
 * alone would report success as soon as the leader exits even when a descendant
 * ignored SIGTERM, so forced termination must wait for both facts.
 */
/* c8 ignore start -- POSIX-only process-group polling; lifecycle integration
 * exercises it on Linux and macOS while Windows uses taskkill above. */
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
