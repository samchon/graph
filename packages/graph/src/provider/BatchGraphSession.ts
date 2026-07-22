import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { GraphLanguage } from "../typings";
import { IBulkGraphSession } from "./IBulkGraphSession";

/**
 * Atomic lifecycle shared by batch semantic providers.
 *
 * A SCIP indexer, compiler plugin, and analyzer sidecar differ in the artifact
 * they write and how that artifact becomes a normalized snapshot. They do not
 * differ in ownership: each runs into an isolated directory, is bounded and
 * cancellable through its exact child handle, rechecks every declared input,
 * and publishes only after the complete candidate has been loaded. Keeping
 * that transaction here prevents each language wrapper from inventing a
 * subtly different close or stale-generation rule.
 */
export class BatchGraphSession implements IBulkGraphSession {
  public readonly kind = "bulk" as const;
  public readonly languages: readonly GraphLanguage[];
  public readonly root: string;

  private readonly options: BatchGraphSession.IOptions;
  private readonly maxStdoutBytes: number;
  private readonly children = new Set<ISpawned>();
  private snapshot: IBulkGraphSession.ISnapshot | undefined;
  private universe = "";
  private version = 0;
  private closed = false;
  private closing: Promise<void> | undefined;
  private queue: Promise<void> = Promise.resolve();

  public constructor(options: BatchGraphSession.IOptions) {
    if (options.languages.length === 0) {
      throw new TypeError(
        `${options.provider}: a batch session must own at least one language`,
      );
    }
    const maxStdoutBytes =
      options.maxStdoutBytes ?? DEFAULT_MAX_PROCESS_STDOUT_BYTES;
    if (!Number.isSafeInteger(maxStdoutBytes) || maxStdoutBytes < 1) {
      throw new TypeError(
        `${options.provider}: maxStdoutBytes must be a positive safe integer`,
      );
    }
    this.options = options;
    this.maxStdoutBytes = maxStdoutBytes;
    this.languages = [...options.languages];
    this.root = options.root;
  }

  public get generation(): number {
    return this.version;
  }

  public get current(): IBulkGraphSession.ISnapshot | undefined {
    return this.snapshot;
  }

  public refresh(
    options: { signal?: AbortSignal } = {},
  ): Promise<IBulkGraphSession.IRefresh> {
    if (this.closed) {
      return Promise.reject(
        new Error(`${this.options.provider}: session is closed`),
      );
    }
    return this.enqueue(async () => {
      this.assertOpen();
      throwIfAborted(options.signal, this.options.provider);
      const universe = this.fingerprint();
      if (universe === this.universe && this.snapshot !== undefined) {
        return {
          changed: false,
          generation: this.version,
          mode: "unchanged" as const,
          snapshot: this.snapshot,
        };
      }
      const next = await this.build(universe, options.signal);
      this.assertOpen();
      this.snapshot = next;
      this.universe = universe;
      this.version += 1;
      return {
        changed: true,
        generation: this.version,
        mode: this.version === 1 ? ("initial" as const) : ("rebuild" as const),
        snapshot: next,
      };
    }, options.signal);
  }

  /** Close every exact child once and wait until all of them have exited. */
  public close(): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    this.closed = true;
    const owned = [...this.children];
    this.children.clear();
    this.closing = Promise.all(owned.map((child) => this.terminate(child))).then(
      () => undefined,
    );
    return this.closing;
  }

  private terminate(child: ISpawned): Promise<undefined> {
    if (child.termination !== undefined) return child.termination;
    const termination = (() => {
      child.process.kill();
      let timer: NodeJS.Timeout | undefined;
      const escalated = new Promise<undefined>((resolve) => {
        timer = setTimeout(() => {
          /* c8 ignore start -- Windows terminates on the first signal; the
           * deterministic POSIX fixture exercises escalation. */
          child.process.kill("SIGKILL");
          resolve(undefined);
          /* c8 ignore stop */
        }, TERMINATION_GRACE_MS);
        timer.unref();
      });
      return Promise.race([child.exit, escalated]).then(async () => {
        if (timer !== undefined) clearTimeout(timer);
        await child.exit;
        return undefined;
      });
    })();
    child.termination = termination;
    return termination;
  }

  private async build(
    universe: string,
    signal: AbortSignal | undefined,
  ): Promise<IBulkGraphSession.ISnapshot> {
    const output = fs.mkdtempSync(
      path.join(os.tmpdir(), `samchon-graph-${this.options.provider}-`),
    );
    try {
      const artifact = path.join(output, this.options.artifactName);
      await this.run(
        this.options.command.command,
        [...this.options.command.args, ...this.options.indexArgs(artifact)],
        signal,
      );
      if (!fs.existsSync(artifact)) {
        throw new Error(
          `${this.options.provider}: the producer exited without writing ${artifact}`,
        );
      }
      const snapshot = await this.options.load({
        artifact,
        universe,
        signal,
        run: (command, args) => this.run(command, args, signal),
      });
      const after = this.fingerprint();
      if (after !== universe) {
        throw new Error(
          `${this.options.provider}: project inputs changed while its artifact ` +
            "was being built, so that artifact cannot be published",
        );
      }
      return snapshot;
    } finally {
      fs.rmSync(output, { recursive: true, force: true });
    }
  }

  private fingerprint(): string {
    const hash = createHash("sha256");
    for (const value of [
      ...(this.options.configuration?.() ?? []),
    ].sort(compareOrdinalPath)) {
      hash.update(`configuration\0${String(Buffer.byteLength(value, "utf8"))}\0`);
      hash.update(value);
      hash.update("\n");
    }
    for (const file of [...this.options.inputs()].sort(compareOrdinalPath)) {
      hash.update(`${file}\0`);
      try {
        hash.update(fs.readFileSync(path.resolve(this.root, file)));
        /* c8 ignore start -- a listed input removed between the walk and this
         * read is itself a difference the next comparison catches. */
      } catch {
        hash.update("\0missing");
      }
      /* c8 ignore stop */
      hash.update("\n");
    }
    return hash.digest("hex");
  }

  /** Run one exact-owned child to completion and retain bounded stdout. */
  private run(
    command: string,
    args: readonly string[],
    signal: AbortSignal | undefined,
  ): Promise<string> {
    this.assertOpen();
    if (signal?.aborted === true) {
      return Promise.reject(abortedProcessError(this.options.provider, command));
    }
    const child = spawn(command, [...args], {
      cwd: this.root,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const exited = deferred();
    const owned: ISpawned = { process: child, exit: exited.promise };
    this.children.add(owned);

    let stdout = "";
    let stdoutBytes = 0;
    let stderr = "";
    let outputFailure: Error | undefined;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      /* c8 ignore next -- termination can leave one already-buffered chunk. */
      if (outputFailure !== undefined) return;
      stdoutBytes += Buffer.byteLength(chunk, "utf8");
      if (stdoutBytes > this.maxStdoutBytes) {
        outputFailure = new Error(
          `${this.options.provider}: ${command} exceeded the ${String(this.maxStdoutBytes)} byte stdout limit`,
        );
        void this.terminate(owned).catch(() => undefined);
        return;
      }
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-MAX_PROCESS_STDERR_CHARS);
    });

    const abort = (): void => {
      void this.terminate(owned).catch(() => undefined);
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (isAborted(signal)) abort();

    return new Promise<string>((resolve, reject) => {
      const finish = (): void => {
        signal?.removeEventListener("abort", abort);
        this.children.delete(owned);
        exited.settle();
      };
      child.on("error", (error) => {
        finish();
        reject(error);
      });
      child.on("close", (code) => {
        finish();
        if (signal?.aborted === true) {
          reject(abortedProcessError(this.options.provider, command));
          return;
        }
        if (outputFailure !== undefined) {
          reject(outputFailure);
          return;
        }
        if (code === 0) {
          resolve(stdout);
          return;
        }
        reject(
          new Error(
            `${this.options.provider}: ${command} exited with code ${String(code)}${
              stderr === "" ? "" : `: ${stderr.trim()}`
            }`,
          ),
        );
      });
    });
  }

  private enqueue<T>(
    task: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    let settle!: (value: T) => void;
    let fail!: (error: Error) => void;
    let started = false;
    let settled = false;
    const result = new Promise<T>((resolve, reject) => {
      settle = (value) => {
        /* c8 ignore next -- a cancelled queued refresh never runs its task. */
        if (settled) return;
        settled = true;
        resolve(value);
      };
      fail = (error) => {
        /* c8 ignore next -- a cancelled queued refresh rejects only once. */
        if (settled) return;
        settled = true;
        reject(error);
      };
    });
    const cancelQueued = (): void => {
      if (!started) fail(abortedProcessError(this.options.provider, "refresh"));
    };
    if (isAborted(signal)) {
      cancelQueued();
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
          settle(await task());
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
        }
      });
    return result;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error(`${this.options.provider}: session is closed`);
    }
  }
}

export namespace BatchGraphSession {
  export interface IOptions {
    root: string;
    languages: readonly GraphLanguage[];
    provider: string;
    command: { command: string; args: readonly string[] };
    artifactName: string;
    indexArgs: (artifact: string) => string[];
    inputs: () => string[];
    /** Non-file build settings whose change invalidates the complete artifact. */
    configuration?: () => readonly string[];
    load: (props: ILoadProps) => Promise<IBulkGraphSession.ISnapshot>;
    maxStdoutBytes?: number;
  }

  export interface ILoadProps {
    artifact: string;
    universe: string;
    signal: AbortSignal | undefined;
    run: (command: string, args: readonly string[]) => Promise<string>;
  }
}

interface ISpawned {
  process: ReturnType<typeof spawn>;
  exit: Promise<undefined>;
  termination?: Promise<undefined>;
}

function deferred(): { promise: Promise<undefined>; settle: () => void } {
  let settle!: () => void;
  const promise = new Promise<undefined>((resolve) => {
    settle = () => {
      resolve(undefined);
    };
  });
  return { promise, settle };
}

const TERMINATION_GRACE_MS = 1_000;
const DEFAULT_MAX_PROCESS_STDOUT_BYTES = 256 * 1024 * 1024;
const MAX_PROCESS_STDERR_CHARS = 64 * 1024;

function abortedProcessError(provider: string, command: string): Error {
  const error = new Error(`${provider}: ${command} was aborted`);
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined, provider: string): void {
  if (isAborted(signal)) throw abortedProcessError(provider, "refresh");
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function compareOrdinalPath(left: string, right: string): number {
  /* c8 ignore next 2 -- input lists hold distinct project-relative paths. */
  return left < right ? -1 : left > right ? 1 : 0;
}
