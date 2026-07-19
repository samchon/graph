import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";

import { IBulkGraphSession } from "../IBulkGraphSession";
import { adaptTtscGraphDump } from "./adaptTtscGraphDump";
import { ITtscGraphSnapshot } from "./ITtscGraphSnapshot";
import { parseTtscGraphSnapshot } from "./parseTtscGraphSnapshot";

const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;
const MAX_TIMER_MS = 2_147_483_647;
const TERMINATION_GRACE_MS = 1_000;

interface NativeChild {
  process: ChildProcessWithoutNullStreams;
  stdoutChunks: string[];
  stderr: string;
}

interface Pending {
  child: NativeChild;
  resolve: (value: ITtscGraphSnapshot) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  signal?: AbortSignal;
  abort?: () => void;
}

/** Resident, restartable NDJSON client for `ttscgraph serve`. */
export class TtscGraphClient implements IBulkGraphSession {
  public readonly kind = "bulk" as const;
  public readonly language = "typescript" as const;
  public readonly root: string;

  private readonly command: string;
  private readonly args: readonly string[];
  private readonly requestTimeoutMs: number;
  private child: NativeChild | undefined;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private queue: Promise<void> = Promise.resolve();
  private closed = false;
  private closing: Promise<void> | undefined;
  private snapshot: IBulkGraphSession.ISnapshot | undefined;
  private version = 0;

  public constructor(options: TtscGraphClient.IOptions) {
    const requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    if (
      !Number.isSafeInteger(requestTimeoutMs) ||
      requestTimeoutMs <= 0 ||
      requestTimeoutMs > MAX_TIMER_MS
    ) {
      throw new TypeError(
        `ttscgraph: requestTimeoutMs must be an integer between 1 and ${String(MAX_TIMER_MS)}`,
      );
    }
    this.root = options.root;
    this.command = options.command;
    this.args = options.args ?? [];
    this.requestTimeoutMs = requestTimeoutMs;
  }

  public get generation(): number {
    return this.version;
  }

  public get current(): IBulkGraphSession.ISnapshot | undefined {
    return this.snapshot;
  }

  public refresh(
    options: TtscGraphClient.IRefreshOptions = {},
  ): Promise<IBulkGraphSession.IRefresh> {
    if (this.closed) {
      return Promise.reject(new Error("ttscgraph: session is closed"));
    }
    return this.enqueue(async () => {
      this.assertOpen();
      try {
        const response = await this.request(options.signal);
        if (response.mode === "error") {
          throw new Error(`ttscgraph: ${response.error}`);
        }
        const mode: IBulkGraphSession.Mode = response.mode;
        if (!response.changed) {
          if (this.snapshot === undefined) {
            throw new Error(
              "ttscgraph: first response was unchanged without a snapshot",
            );
          }
          assertCapabilitiesMatch(
            response.capabilities,
            this.snapshot.provenance.capabilities,
          );
          return {
            changed: false,
            generation: this.version,
            mode,
            snapshot: this.snapshot,
          };
        }

        const adapted = adaptTtscGraphDump(response.dump, this.root);
        const provenance: IBulkGraphSession.IProvenance = {
          ...adapted.provenance,
          protocolVersion: response.protocolVersion,
        };
        assertCapabilitiesMatch(response.capabilities, provenance.capabilities);
        if (
          mode === "incremental" &&
          this.snapshot !== undefined &&
          this.snapshot.provenance.universe !== provenance.universe
        ) {
          throw new Error(
            "ttscgraph: incremental snapshot reports a build universe that moved since the last generation, so its program cannot have been reused",
          );
        }
        const next: IBulkGraphSession.ISnapshot = {
          language: "typescript",
          nodes: adapted.nodes,
          edges: adapted.edges,
          diagnostics: adapted.diagnostics,
          sources: adapted.sources,
          provenance,
          warnings: adapted.warnings,
        };
        this.snapshot = next;
        this.version += 1;
        return {
          changed: true,
          generation: this.version,
          mode,
          snapshot: next,
        };
      } catch (error) {
        const child = this.child;
        if (child !== undefined) this.failChild(child, asError(error));
        throw error;
      }
    }, options.signal);
  }

  /** Close immediately even when a serialized refresh is stalled. */
  public close(): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    this.closed = true;
    const error = new Error("ttscgraph: session is closed");
    const child = this.child;
    if (child === undefined) {
      this.failPending(error);
      this.closing = Promise.resolve();
      return this.closing;
    }
    this.failChild(child, error);
    this.closing = (async () => {
      if (await waitForExit(child.process, 2_000)) return;
      terminateChild(child.process, true);
      /* c8 ignore start */
      if (!(await waitForExit(child.process, 2_000))) {
        throw new Error("ttscgraph: owned process did not exit after close");
      }
      /* c8 ignore stop */
    })();
    return this.closing;
  }

  private request(signal?: AbortSignal): Promise<ITtscGraphSnapshot> {
    if (signal?.aborted) throw cancelledError(signal);
    const child = this.ensureChild();
    const id = this.nextId++;
    return new Promise<ITtscGraphSnapshot>((resolve, reject) => {
      const pending: Pending = {
        child,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.failChild(
            child,
            new Error(
              `ttscgraph: snapshot request timed out after ${String(this.requestTimeoutMs)} ms${stderrSuffix(child)}`,
            ),
          );
        }, this.requestTimeoutMs),
        signal,
      };
      pending.timer.unref();
      if (signal !== undefined) {
        pending.abort = () =>
          this.failChild(child, cancelledError(signal, child));
        signal.addEventListener("abort", pending.abort, { once: true });
      }
      this.pending.set(id, pending);
      if (signal?.aborted) {
        pending.abort!();
        return;
      }
      child.process.stdin.write(`${JSON.stringify({ id })}\n`, (error) => {
        if (error === null || error === undefined) return;
        if (this.pending.get(id) !== pending) return;
        this.failChild(
          child,
          new Error(`ttscgraph: could not request snapshot: ${error.message}`),
        );
      });
    });
  }

  private ensureChild(): NativeChild {
    this.assertOpen();
    if (
      this.child !== undefined &&
      this.child.process.exitCode === null &&
      this.child.process.signalCode === null
    ) {
      return this.child;
    }
    const spawned = spawn(
      this.command,
      [...this.args, "serve", "--cwd", this.root],
      {
        cwd: this.root,
        env: process.env,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    const child: NativeChild = {
      process: spawned,
      stdoutChunks: [],
      stderr: "",
    };
    this.child = child;
    spawned.stdout.setEncoding("utf8");
    spawned.stderr.setEncoding("utf8");
    spawned.stdout.on("data", (chunk: string) => this.consume(child, chunk));
    spawned.stderr.on("data", (chunk: string) => {
      child.stderr = (child.stderr + chunk).slice(-64 * 1024);
    });
    spawned.on("error", (error) =>
      this.failChild(
        child,
        new Error(`ttscgraph: process failed: ${error.message}`),
      ),
    );
    /* c8 ignore start */
    spawned.stdin.on("error", (error) =>
      this.failChild(
        child,
        new Error(`ttscgraph: stdin failed: ${error.message}`),
      ),
    );
    /* c8 ignore stop */
    spawned.on("exit", (code, signal) => {
      const status = signal ?? code;
      this.failChild(
        child,
        new Error(
          `ttscgraph: process exited (${status})${stderrSuffix(child)}`,
        ),
        false,
      );
    });
    return child;
  }

  private consume(child: NativeChild, chunk: string): void {
    if (this.child !== child) return;
    let start = 0;
    for (;;) {
      const newline = chunk.indexOf("\n", start);
      if (newline === -1) {
        if (start < chunk.length) child.stdoutChunks.push(chunk.slice(start));
        return;
      }
      child.stdoutChunks.push(chunk.slice(start, newline));
      const line = child.stdoutChunks.join("").trim();
      child.stdoutChunks.length = 0;
      start = newline + 1;
      if (line === "") continue;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch (error) {
        this.failChild(
          child,
          new Error(
            `ttscgraph: invalid NDJSON response: ${asError(error).message}`,
          ),
        );
        return;
      }
      let response: ITtscGraphSnapshot;
      try {
        response = parseTtscGraphSnapshot(value);
      } catch (error) {
        this.failChild(child, asError(error));
        return;
      }
      const pending = this.pending.get(response.id);
      if (pending === undefined || pending.child !== child) {
        this.failChild(
          child,
          new Error(`ttscgraph: unexpected response id ${String(response.id)}`),
        );
        return;
      }
      this.settlePending(response.id, pending, response);
    }
  }

  private failChild(
    child: NativeChild,
    error: Error,
    terminate = true,
  ): void {
    if (this.child !== child) return;
    this.child = undefined;
    this.snapshot = undefined;
    this.failPending(error, child);
    if (terminate) terminateChild(child.process);
  }

  private failPending(error: Error, child?: NativeChild): void {
    for (const [id, pending] of this.pending) {
      if (child === undefined || pending.child === child) {
        this.settlePending(id, pending, error);
      }
    }
  }

  private settlePending(
    id: number,
    pending: Pending,
    result: ITtscGraphSnapshot | Error,
  ): void {
    if (this.pending.get(id) !== pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (pending.signal !== undefined && pending.abort !== undefined) {
      pending.signal.removeEventListener("abort", pending.abort);
    }
    if (result instanceof Error) pending.reject(result);
    else pending.resolve(result);
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("ttscgraph: session is closed");
  }

  private enqueue<T>(
    task: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    let resolveResult!: (value: T) => void;
    let rejectResult!: (error: Error) => void;
    let started = false;
    let settled = false;
    const result = new Promise<T>((resolve, reject) => {
      resolveResult = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      rejectResult = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
    });
    const cancelQueued = (): void => {
      if (!started) rejectResult(cancelledError(signal));
    };
    if (signal?.aborted) {
      rejectResult(cancelledError(signal));
      return result;
    }
    signal?.addEventListener("abort", cancelQueued, { once: true });
    this.queue = this.queue
      .catch(() => undefined)
      .then(async () => {
        started = true;
        signal?.removeEventListener("abort", cancelQueued);
        if (settled) return;
        try {
          resolveResult(await task());
        } catch (error) {
          rejectResult(asError(error));
        }
      });
    return result;
  }
}

export namespace TtscGraphClient {
  export interface IOptions {
    root: string;
    command: string;
    args?: readonly string[];
    /** Maximum time for one native snapshot response. */
    requestTimeoutMs?: number;
  }

  export interface IRefreshOptions {
    /** Cancel this refresh and retire the native child generation it owns. */
    signal?: AbortSignal;
  }
}

function terminateChild(
  child: ChildProcessWithoutNullStreams,
  forceNow = false,
): void {
  if (!child.stdin.destroyed) child.stdin.destroy();
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill(forceNow ? "SIGKILL" : undefined);
  } catch {
    return;
  }
  if (forceNow) return;
  const force = setTimeout(() => terminateChild(child, true), TERMINATION_GRACE_MS);
  force.unref();
  child.once("exit", () => clearTimeout(force));
}

function waitForExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean): void => {
      /* c8 ignore next */
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("exit", exited);
      child.off("close", exited);
      resolve(value);
    };
    const exited = (): void => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once("exit", exited);
    child.once("close", exited);
  });
}

function cancelledError(signal?: AbortSignal, child?: NativeChild): Error {
  const error = new Error(
    `ttscgraph: snapshot request cancelled${abortDetail(signal)}${
      child === undefined ? "" : stderrSuffix(child)
    }`,
  );
  error.name = "AbortError";
  return error;
}

function abortDetail(signal?: AbortSignal): string {
  const reason = signal?.reason;
  if (reason === undefined) return "";
  try {
    return `: ${reason instanceof Error ? reason.message : String(reason)}`;
  } catch {
    return "";
  }
}

function stderrSuffix(child: NativeChild): string {
  const stderr = child.stderr.trim();
  return stderr === "" ? "" : `: ${stderr}`;
}

function asError(error: unknown): Error {
  /* c8 ignore next */
  return error instanceof Error ? error : new Error(String(error));
}

function assertCapabilitiesMatch(
  envelope: readonly string[],
  dump: readonly string[],
): void {
  const compare = (left: string, right: string): number =>
    left < right ? -1 : left > right ? 1 : 0;
  const left = JSON.stringify([...envelope].sort(compare));
  const right = JSON.stringify([...dump].sort(compare));
  if (left !== right) {
    throw new Error(
      "ttscgraph: response capabilities disagree with the snapshot provenance",
    );
  }
}
