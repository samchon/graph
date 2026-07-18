import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { IBulkGraphSession } from "../IBulkGraphSession";
import { adaptTtscGraphDump } from "./adaptTtscGraphDump";
import { ITtscGraphSnapshot } from "./ITtscGraphSnapshot";
import { parseTtscGraphSnapshot } from "./parseTtscGraphSnapshot";

/**
 * Resident NDJSON client for `ttscgraph serve`.
 *
 * One request per refresh, and no disk read. Both of those used to be false and
 * were the same defect: this client adapted the dump, then `readText`-ed every
 * file the dump named — off the disk, outside the compiler's program, at a
 * later instant — and then issued a *second* `{id}` round-trip purely to ask
 * whether anything had moved in between, looping if it had.
 *
 * That protocol narrowed the race without closing it, and could not close it. A
 * write that lands and reverts between the dump and the confirmation is
 * invisible to both. And a clean confirmation only ever proved that the *server*
 * saw no change — never that the bytes this process read are the bytes the
 * checker resolved against, which is the only thing the sources were wanted for.
 * Under a source-preamble plugin the two are not even supposed to match.
 *
 * The manifest ends the question by answering it at the source: the producer
 * publishes the digest of the text its checker read, in the same envelope as
 * the facts. There is nothing left to confirm, so there is no second request,
 * and nothing left to read, so there is no disk access.
 */
export class TtscGraphClient implements IBulkGraphSession {
  public readonly kind = "bulk" as const;
  public readonly language = "typescript" as const;
  public readonly root: string;

  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: ITtscGraphSnapshot) => void;
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
      const response = await this.request();
      // Narrowing, not a lookup: `mode` is typed `"error"` exactly on the frames
      // that carry one, so ruling failure out here is what makes the rest of
      // this method unable to ask for a snapshot that was never produced.
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
        return {
          changed: false,
          generation: this.version,
          mode,
          snapshot: this.snapshot,
        };
      }

      // Parse and validate the complete response before publishing any part of
      // it. A malformed full dump leaves both the previous snapshot and its
      // generation untouched.
      const adapted = adaptTtscGraphDump(response.dump, this.root);
      const provenance: IBulkGraphSession.IProvenance = {
        ...adapted.provenance,
        protocolVersion: response.protocolVersion,
      };
      // `incremental` means the resident program was reused, and a program can
      // only be reused while the inputs that decide its file set hold still —
      // that is what separates it from `reload` upstream. So the claim has
      // independent evidence riding beside it, and checking costs one string
      // compare. A producer whose universe moved under an `incremental` label
      // is not a producer whose mode is cosmetically wrong: it is one that
      // reused a program it should have reloaded, and every fact in the
      // snapshot is suspect. Report `mode` honestly means refusing to report a
      // `mode` the snapshot itself contradicts.
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

  private request(): Promise<ITtscGraphSnapshot> {
    const id = this.nextId++;
    const response = new Promise<ITtscGraphSnapshot>((resolve, reject) => {
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
          new Error(
            `ttscgraph: invalid NDJSON response: ${asError(error).message}`,
          ),
        );
        continue;
      }
      let response: ITtscGraphSnapshot;
      try {
        // The whole frame is validated here, before it is routed. A protocol
        // mismatch or a malformed envelope is never one caller's bad luck — it
        // is the wrong binary, or a producer this client cannot read at all, so
        // every request outstanding against it is equally doomed and fails with
        // that same reason rather than hanging until the process exits.
        response = parseTtscGraphSnapshot(value);
      } catch (error) {
        this.rejectPending(asError(error));
        continue;
      }
      const pending = this.pending.get(response.id);
      if (pending === undefined) {
        this.rejectPending(
          new Error(`ttscgraph: unexpected response id ${String(response.id)}`),
        );
        continue;
      }
      this.pending.delete(response.id);
      pending.resolve(response);
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
