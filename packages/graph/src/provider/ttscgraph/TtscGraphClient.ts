import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { readText } from "../../utils/fs";
import { IBulkGraphSession } from "../IBulkGraphSession";
import { adaptTtscGraphDump } from "./adaptTtscGraphDump";

/** Resident NDJSON client for `ttscgraph serve`. */
export class TtscGraphClient implements IBulkGraphSession {
  public readonly kind = "bulk" as const;
  public readonly language = "typescript" as const;
  public readonly root: string;

  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();
  private nextId = 1;
  private readonly stdoutChunks: string[] = [];
  private stderr = "";
  private queue: Promise<void> = Promise.resolve();
  private closed = false;
  private closing: Promise<void> | undefined;
  private snapshot: IBulkGraphSession.ISnapshot | undefined;
  private version = 0;

  public constructor(options: TtscGraphClient.IOptions) {
    this.root = options.root;
    this.child = spawn(
      options.command,
      [...(options.args ?? []), "serve", "--cwd", options.root],
      {
        cwd: options.root,
        env: process.env,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => {
      this.consume(chunk);
    });
    this.child.stderr.on("data", (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-64 * 1024);
    });
    this.child.on("error", (error) => {
      this.rejectPending(error);
    });
    this.child.stdin.on("error", (error) => {
      this.rejectPending(error);
    });
    this.child.on("exit", (code, signal) => {
      this.rejectPending(
        new Error(
          `ttscgraph: process exited (${signal ?? code ?? "unknown"})${
            this.stderr.trim() === "" ? "" : `: ${this.stderr.trim()}`
          }`,
        ),
      );
    });
  }

  public get generation(): number {
    return this.version;
  }

  public get current(): IBulkGraphSession.ISnapshot | undefined {
    return this.snapshot;
  }

  public refresh(): Promise<IBulkGraphSession.IRefresh> {
    return this.enqueue(async () => {
      this.assertOpen();
      let response = responseOf(await this.request());
      for (;;) {
        if (response.error !== undefined) {
          throw new Error(`ttscgraph: ${response.error}`);
        }
        if (!response.changed) {
          assertUnchanged(response);
          if (this.snapshot === undefined) {
            throw new Error("ttscgraph: first response was unchanged without a snapshot");
          }
          return {
            changed: false,
            generation: this.version,
            mode: response.mode,
            snapshot: this.snapshot,
          };
        }
        if (response.dump === undefined) {
          throw new Error("ttscgraph: changed response omitted its full dump");
        }

        // Parse and validate the complete response before publishing any part
        // of it. A malformed full dump leaves both the previous snapshot and
        // its generation untouched.
        const adapted = adaptTtscGraphDump(response.dump, this.root);
        const sources = new Map<string, string>();
        for (const file of adapted.files) {
          const text = readText(file);
          if (text !== undefined) sources.set(file, text);
        }

        // Confirm the compiler session still owns this disk snapshot before
        // exposing its source map. If another edit landed while the full dump
        // was encoded, ttscgraph returns another full dump and this loop adapts
        // that newer generation instead.
        const confirmation = responseOf(await this.request());
        if (confirmation.error !== undefined) {
          throw new Error(`ttscgraph: ${confirmation.error}`);
        }
        if (confirmation.changed) {
          response = confirmation;
          continue;
        }
        assertUnchanged(confirmation);
        const next: IBulkGraphSession.ISnapshot = {
          language: "typescript",
          nodes: adapted.nodes,
          edges: adapted.edges,
          sources,
          warnings: [],
        };
        this.snapshot = next;
        this.version += 1;
        return {
          changed: true,
          generation: this.version,
          mode: response.mode,
          snapshot: next,
        };
      }
    });
  }

  public close(): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    this.closed = true;
    this.closing = this.enqueue(async () => {
      if (this.child.exitCode !== null || this.child.signalCode !== null) return;
      this.child.stdin.end();
      if (await waitForExit(this.child, 2_000)) return;
      // This exact ChildProcess is owned by this client. No PID lookup or
      // process-tree operation is used, so an unrelated process cannot be hit.
      this.child.kill();
      if (!(await waitForExit(this.child, 2_000))) {
        throw new Error("ttscgraph: owned process did not exit after close");
      }
    });
    return this.closing;
  }

  private request(): Promise<unknown> {
    const id = this.nextId++;
    const response = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.child.stdin.write(`${JSON.stringify({ id })}\n`, (error) => {
      if (error === null || error === undefined) return;
      const pending = this.pending.get(id);
      this.pending.delete(id);
      pending?.reject(error);
    });
    return response;
  }

  private consume(chunk: string): void {
    let start = 0;
    for (;;) {
      const newline = chunk.indexOf("\n", start);
      if (newline === -1) {
        if (start < chunk.length) this.stdoutChunks.push(chunk.slice(start));
        return;
      }
      this.stdoutChunks.push(chunk.slice(start, newline));
      const line = this.stdoutChunks.join("").trim();
      this.stdoutChunks.length = 0;
      start = newline + 1;
      if (line === "") continue;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch (error) {
        this.rejectPending(
          new Error(`ttscgraph: invalid NDJSON response: ${asError(error).message}`),
        );
        continue;
      }
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        this.rejectPending(new Error("ttscgraph: response must be an object"));
        continue;
      }
      const id = (value as { id?: unknown }).id;
      if (!Number.isSafeInteger(id)) {
        this.rejectPending(new Error("ttscgraph: response omitted a valid id"));
        continue;
      }
      const pending = this.pending.get(id as number);
      if (pending === undefined) {
        this.rejectPending(new Error(`ttscgraph: unexpected response id ${id}`));
        continue;
      }
      this.pending.delete(id as number);
      pending.resolve(value);
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("ttscgraph: session is closed");
    if (this.child.exitCode !== null || this.child.signalCode !== null) {
      throw new Error(
        `ttscgraph: process is not running${
          this.stderr.trim() === "" ? "" : `: ${this.stderr.trim()}`
        }`,
      );
    }
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    let resolveResult!: (value: T) => void;
    let rejectResult!: (error: Error) => void;
    const result = new Promise<T>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    this.queue = this.queue
      .catch(() => undefined)
      .then(async () => {
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
  }
}

interface IServeResponse {
  changed: boolean;
  dump?: unknown;
  error?: string;
  mode: string;
}

function responseOf(value: unknown): IServeResponse {
  const response = value as Record<string, unknown>;
  if (typeof response.changed !== "boolean") {
    throw new Error("ttscgraph: response.changed must be boolean");
  }
  if (response.error !== undefined && typeof response.error !== "string") {
    throw new Error("ttscgraph: response.error must be a string");
  }
  if (response.mode !== undefined && typeof response.mode !== "string") {
    throw new Error("ttscgraph: response.mode must be a string");
  }
  return {
    changed: response.changed,
    ...(response.dump === undefined ? {} : { dump: response.dump }),
    ...(response.error === undefined ? {} : { error: response.error }),
    mode: (response.mode as string | undefined) ?? "",
  };
}

function assertUnchanged(response: IServeResponse): void {
  if (response.dump !== undefined) {
    throw new Error("ttscgraph: unchanged response unexpectedly included a dump");
  }
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
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("exit", exited);
      resolve(value);
    };
    const exited = (): void => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once("exit", exited);
  });
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
