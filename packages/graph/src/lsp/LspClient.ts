import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { EventEmitter } from "node:events";

interface IRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout | undefined;
  signal?: AbortSignal;
  abort?: () => void;
}

export class LspClient {
  private readonly process: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, IRequest>();
  private readonly events = new EventEmitter();
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private exited = false;
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
    this.process.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
    this.process.stderr.on("data", () => {
      // Language servers often log noisy progress to stderr.
    });
    this.process.on("error", (error) => {
      this.exited = true;
      this.rejectAll(error);
    });
    this.process.on("exit", (code, signal) => {
      this.exited = true;
      this.rejectAll(
        new Error(
          `Language server exited (${code ?? "null"}, ${signal ?? "null"}).`,
        ),
      );
    });
  }

  public async request<T>(
    method: string,
    params: unknown,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) throw abortedError(method);
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
    if (!this.exited) {
      // Teardown is the one bounded place: indexing requests wait forever, but a
      // `shutdown` that never comes back must not leak the child process. Wait
      // briefly for a graceful shutdown, then fall through to the kill below.
      await Promise.race([
        this.request("shutdown", null).catch(() => {}),
        new Promise((resolve) => {
          const timer = setTimeout(resolve, 1000);
          timer.unref?.();
        }),
      ]);
      /* c8 ignore start */
      try {
        this.notify("exit", null);
      } catch {
        // Ignore close errors.
      }
      /* c8 ignore stop */
      await this.waitForExit(1000);
    }
    if (
      this.process.pid !== undefined &&
      this.process.exitCode === null &&
      this.process.signalCode === null
    )
      this.process.kill();
  }

  private waitForExit(timeoutMs: number): Promise<void> {
    if (this.exited) return Promise.resolve();
    return new Promise((resolve) => {
      const onExit = (): void => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        this.process.off("exit", onExit);
        resolve();
      }, timeoutMs);
      timer.unref?.();
      this.process.once("exit", onExit);
    });
  }

  private write(payload: unknown): void {
    const body = Buffer.from(JSON.stringify(payload), "utf8");
    const header = Buffer.from(
      `Content-Length: ${body.length}\r\n\r\n`,
      "ascii",
    );
    this.process.stdin.write(Buffer.concat([header, body]));
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
