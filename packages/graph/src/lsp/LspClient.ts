import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { EventEmitter } from "node:events";

const SHUTDOWN_GRACE_MS = 1_000;
const TERMINATION_GRACE_MS = 1_000;
const FORCED_EXIT_GRACE_MS = 2_000;

interface IRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout | undefined;
  signal?: AbortSignal;
  abort?: () => void;
}

export class LspClient {
  private readonly process: ChildProcessWithoutNullStreams;
  private readonly exit: Promise<void>;
  private readonly pending = new Map<number, IRequest>();
  private readonly events = new EventEmitter();
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private exited = false;
  private failure: Error | undefined;
  private termination: Promise<void> | undefined;
  private closing: Promise<void> | undefined;

  public constructor(
    command: string,
    args: readonly string[],
    private readonly timeoutMs?: number,
    cwd?: string,
  ) {
    this.process = spawn(command, [...args], {
      cwd,
      stdio: "pipe",
      windowsHide: true,
    });
    this.exit = exitOf(this.process);
    this.process.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
    this.process.stderr.on("data", () => {
      // Language servers often log noisy progress to stderr.
    });
    this.process.on("error", (error) => {
      this.exited = true;
      this.fail(error);
    });
    this.process.on("exit", (code, signal) => {
      this.exited = true;
      this.fail(
        new Error(
          `Language server exited (${String(code)}, ${String(signal)}).`,
        ),
      );
    });
    this.process.stdin.on("error", (error) => {
      this.failTransport(stdinError(error));
    });
  }

  public async request<T>(
    method: string,
    params: unknown,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) throw abortedError(method);
    if (this.failure !== undefined) throw this.failure;
    // Requests are unlimited when neither the client nor this call specifies a
    // deadline or cancellation signal. Bounded callers can still prevent a
    // non-answering server from holding an experiment or resident shutdown
    // forever without changing the normal unlimited request contract.
    const id = this.nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };
    const promise = new Promise<T>((resolve, reject) => {
      const effectiveTimeoutMs = timeoutMs ?? this.timeoutMs;
      const pending: IRequest = {
        resolve: (value) => resolve(value as T),
        reject,
        timer: undefined,
        signal,
      };
      this.pending.set(id, pending);
      if (effectiveTimeoutMs !== undefined) {
        pending.timer = setTimeout(() => {
          this.deletePending(id, pending);
          reject(new Error(`LSP request timed out: ${method}`));
        }, effectiveTimeoutMs);
      }
      if (signal !== undefined) {
        pending.abort = () => {
          this.deletePending(id, pending);
          reject(abortedError(method));
        };
        signal.addEventListener("abort", pending.abort, { once: true });
      }
    });
    this.write(payload);
    return promise;
  }

  public notify(method: string, params: unknown): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  public onNotification(
    method: string,
    listener: (params: unknown) => void,
  ): void {
    this.events.on(method, listener);
  }

  public close(): Promise<void> {
    this.closing ??= this.closeOnce();
    return this.closing;
  }

  private async closeOnce(): Promise<void> {
    // A process that already exited (crashed, or exited in response to a
    // request it was never meant to answer, e.g. a bad `initialize`) cannot
    // answer `shutdown`; sending it anyway would just wait out the full
    // request timeout for nothing.
    if (!this.exited && this.failure === undefined) {
      // Teardown is the one bounded place: indexing requests wait forever, but a
      // `shutdown` that never comes back must not leak the child process. Wait
      // briefly for a graceful shutdown, then fall through to the kill below.
      await Promise.race([
        this.request("shutdown", null).catch(() => {}),
        new Promise((resolve) => {
          const timer = setTimeout(resolve, SHUTDOWN_GRACE_MS);
          timer.unref?.();
        }),
      ]);
      /* c8 ignore start */
      if (!this.exited && this.failure === undefined) {
        try {
          this.notify("exit", null);
        } catch {
          // Ignore close errors.
        }
      }
      /* c8 ignore stop */
      if (await waitForExit(this.exit, SHUTDOWN_GRACE_MS)) return;
    }
    if (this.termination !== undefined) await this.termination;
    else if (!this.exited) await this.terminate();
  }

  private write(payload: unknown): void {
    if (this.failure !== undefined) return;
    const body = Buffer.from(JSON.stringify(payload), "utf8");
    const header = Buffer.from(
      `Content-Length: ${body.length}\r\n\r\n`,
      "ascii",
    );
    try {
      this.process.stdin.write(Buffer.concat([header, body]), (error) => {
        if (error !== null && error !== undefined) {
          this.failTransport(stdinError(error));
        }
      });
    } catch (error) {
      this.failTransport(stdinError(error));
    }
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = this.buffer.slice(0, headerEnd).toString("ascii");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (match === null) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + length;
      if (this.buffer.length < bodyEnd) return;
      const body = this.buffer.slice(bodyStart, bodyEnd).toString("utf8");
      this.buffer = this.buffer.slice(bodyEnd);
      // A malformed frame must not throw out of the stdout `data` listener as an
      // uncaught exception; drop it and keep draining the buffer.
      let message;
      try {
        message = JSON.parse(body) as {
          id?: number;
          method?: string;
          params?: unknown;
          result?: unknown;
          error?: { message?: string };
        };
      } catch {
        continue;
      }
      this.handleMessage(message);
    }
  }

  private handleMessage(message: {
    id?: number;
    method?: string;
    params?: unknown;
    result?: unknown;
    error?: { message?: string };
  }): void {
    // A server-initiated request carries both an id and a method. It must be
    // answered or some servers block: gopls, for instance, withholds
    // documentSymbol until its `window/workDoneProgress/create` request is
    // acknowledged. A null result satisfies the acknowledgements we advertise.
    if (message.id !== undefined && message.method !== undefined) {
      this.write({ jsonrpc: "2.0", id: message.id, result: null });
      return;
    }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (pending === undefined) return;
      this.deletePending(message.id, pending);
      if (message.error !== undefined) {
        pending.reject(
          new Error(message.error.message ?? "LSP request failed."),
        );
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (message.method !== undefined) this.events.emit(
      message.method,
      message.params,
    );
  }

  private rejectAll(error: Error): void {
    for (const [id, request] of this.pending) {
      this.deletePending(id, request);
      request.reject(error);
    }
  }

  private fail(error: Error): void {
    this.failure ??= error;
    this.rejectAll(this.failure);
  }

  private failTransport(error: Error): void {
    this.fail(error);
    if (this.exited) return;
    void this.terminate().catch(() => undefined);
  }

  private terminate(): Promise<void> {
    if (this.termination === undefined) {
      // `taskkill /T /F` reports an ordinary numeric exit for the wrapper on
      // Windows. Preserve the transport's forced-termination contract for
      // pending requests while the termination promise below still waits for
      // the exact owned process tree to disappear.
      if (process.platform === "win32" && this.failure === undefined) {
        this.fail(new Error("Language server exited (null, SIGKILL)."));
      }
      this.termination = terminateOwnedProcess(this.process, this.exit);
    }
    return this.termination;
  }

  private deletePending(id: number, request: IRequest): void {
    this.pending.delete(id);
    if (request.timer !== undefined) clearTimeout(request.timer);
    if (request.abort !== undefined) {
      request.signal!.removeEventListener("abort", request.abort);
    }
  }
}

function abortedError(method: string): Error {
  const error = new Error(`LSP request aborted: ${method}`);
  error.name = "AbortError";
  return error;
}

function stdinError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`Language server stdin failed: ${message}`);
}

async function terminateOwnedProcess(
  child: ChildProcessWithoutNullStreams,
  exit: Promise<void>,
): Promise<void> {
  if (!child.stdin.destroyed) child.stdin.destroy();
  /* c8 ignore next -- child exit can win the race into its owned teardown. */
  if (!isRunning(child)) return;
  /* c8 ignore start -- exactly one OS termination lane can execute on a
   * coverage host. Windows and POSIX integration tests still exercise their
   * respective process-tree and SIGTERM-to-SIGKILL behavior. */
  if (process.platform === "win32") {
    await killWindowsProcessTree(child.pid!);
    if (await waitForExit(exit, FORCED_EXIT_GRACE_MS)) return;
    throw new Error(
      "Language server process tree did not exit after forced termination.",
    );
  }
  signalChild(child, "SIGTERM");
  if (await waitForExit(exit, TERMINATION_GRACE_MS)) return;
  signalChild(child, "SIGKILL");
  if (!(await waitForExit(exit, FORCED_EXIT_GRACE_MS))) {
    throw new Error(
      "Language server did not exit after forced termination.",
    );
  }
  /* c8 ignore stop */
}

function isRunning(child: ChildProcessWithoutNullStreams): boolean {
  return (
    child.pid !== undefined &&
    child.exitCode === null &&
    child.signalCode === null
  );
}

/* c8 ignore start -- POSIX-only helper; its fixed valid signals and owned
 * handle are covered by the POSIX lifecycle integration test. */
function signalChild(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals,
): void {
  try {
    child.kill(signal);
  } catch {
    return;
  }
}
/* c8 ignore stop */

/* c8 ignore start -- Windows-only helper; the Windows lifecycle integration
 * test proves exact-tree termination and unrelated-process preservation. */
function killWindowsProcessTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    const killer = spawn(
      "taskkill.exe",
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
      /* c8 ignore next -- the timer and child-exit promise may race after the
       * first one has already settled this bounded wait. */
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

function exitOf(child: ChildProcessWithoutNullStreams): Promise<void> {
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
