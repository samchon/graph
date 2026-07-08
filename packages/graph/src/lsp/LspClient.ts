import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { EventEmitter } from "node:events";

interface IRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class LspClient {
  private readonly process: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, IRequest>();
  private readonly events = new EventEmitter();
  private buffer = Buffer.alloc(0);
  private nextId = 1;

  public constructor(
    command: string,
    args: readonly string[],
    private readonly timeoutMs: number,
  ) {
    this.process = spawn(command, [...args], {
      stdio: "pipe",
      windowsHide: true,
    });
    this.process.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
    this.process.stderr.on("data", () => {
      // Language servers often log noisy progress to stderr.
    });
    this.process.on("error", (error) => this.rejectAll(error));
    this.process.on("exit", (code, signal) => {
      this.rejectAll(
        new Error(`Language server exited (${code ?? "null"}, ${signal ?? "null"}).`),
      );
    });
  }

  public async request<T>(
    method: string,
    params: unknown,
    timeoutMs?: number,
  ): Promise<T> {
    const id = this.nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };
    const promise = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP request timed out: ${method}`));
      }, timeoutMs ?? this.timeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
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

  public async close(): Promise<void> {
    try {
      await this.request("shutdown", null);
    } catch {
      // Some servers exit before answering shutdown.
    }
    /* c8 ignore start */
    try {
      this.notify("exit", null);
    } catch {
      // Ignore close errors.
    }
    /* c8 ignore stop */
    if (!this.process.killed) this.process.kill();
  }

  private write(payload: unknown): void {
    const body = Buffer.from(JSON.stringify(payload), "utf8");
    const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii");
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
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error !== undefined) {
        pending.reject(new Error(message.error.message ?? "LSP request failed."));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (message.method !== undefined) this.events.emit(message.method, message.params);
  }

  private rejectAll(error: Error): void {
    for (const [id, request] of this.pending) {
      this.pending.delete(id);
      clearTimeout(request.timer);
      request.reject(error);
    }
  }
}
