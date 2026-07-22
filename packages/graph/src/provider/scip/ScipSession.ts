import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { GraphLanguage, GraphProviderAuthority } from "../../typings";
import { IBulkGraphSession } from "../IBulkGraphSession";
import { adaptScipIndex } from "./adaptScipIndex";
import { IScipIndex } from "./IScipIndex";
import { parseScipIndex } from "./parseScipIndex";

/**
 * A strict bulk session over a language-owned SCIP indexer.
 *
 * The indexer is run into an isolated output directory, its binary index is
 * decoded through a pinned helper, and the result is validated and mapped
 * before anything is published. Nothing partial is ever published: a decode,
 * validation, or mapping failure leaves the previous generation exactly where
 * it was, because a snapshot that is half of one index and half of another is
 * not a smaller answer, it is a wrong one.
 *
 * Incrementality is honest rather than claimed. This milestone rebuilds a
 * language's artifact whenever its inputs move, and reports `rebuild`; it
 * reports `unchanged` only when the fingerprint of those inputs is byte-for-
 * byte what produced the current snapshot. A generation counter that advanced
 * on every poll would look identical from outside and mean nothing.
 */
export class ScipSession implements IBulkGraphSession {
  public readonly kind = "bulk" as const;
  public readonly languages: readonly GraphLanguage[];
  public readonly root: string;

  private readonly options: ScipSession.IOptions;
  private readonly maxStdoutBytes: number;
  private readonly children = new Set<ISpawned>();
  private snapshot: IBulkGraphSession.ISnapshot | undefined;
  private universe = "";
  private version = 0;
  private closed = false;
  private closing: Promise<void> | undefined;
  private queue: Promise<void> = Promise.resolve();

  public constructor(options: ScipSession.IOptions) {
    if (options.languages.length === 0) {
      throw new TypeError("scip: a session must own at least one language");
    }
    const maxStdoutBytes =
      options.maxStdoutBytes ?? DEFAULT_MAX_PROCESS_STDOUT_BYTES;
    if (!Number.isSafeInteger(maxStdoutBytes) || maxStdoutBytes < 1) {
      throw new TypeError("scip: maxStdoutBytes must be a positive safe integer");
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
      // Published only once every step above succeeded.
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

  /**
   * Begin shutdown immediately, and settle only after every owned child exits.
   *
   * The result is cached because close is idempotent by contract and because
   * the naive form is worse than merely repetitive: a second caller would find
   * the child set already emptied by the first, and return *before* those
   * children had exited. Two callers would then disagree about whether the
   * session was closed, and the one who was wrong is the one who asked second.
   */
  public close(): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    this.closed = true;
    // Only the exact objects this session spawned. Nothing here scans the
    // process table or matches on a name: another copy of the same indexer
    // belongs to somebody else.
    const owned = [...this.children];
    this.children.clear();
    this.closing = Promise.all(owned.map((child) => this.terminate(child))).then(
      () => undefined,
    );
    return this.closing;
  }

  /**
   * End one owned child, escalating if it does not go.
   *
   * An indexer that ignores its termination signal — mid-write, blocked on a
   * lock, wedged in a runtime's shutdown hook — would otherwise hold `close`
   * open forever, and a resident server's shutdown with it. The grace period
   * is short because nothing here needs a clean exit: the artifact directory
   * is discarded either way.
   */
  private terminate(child: ISpawned): Promise<undefined> {
    if (child.termination !== undefined) return child.termination;
    const termination = (() => {
      child.process.kill();
      let timer: NodeJS.Timeout | undefined;
      const escalated = new Promise<undefined>((resolve) => {
        timer = setTimeout(() => {
          /* c8 ignore start -- Windows terminates on the first signal, so the
           * escalation is unreachable there. POSIX exercises it through the
           * fixture indexer that ignores SIGTERM. */
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
      const artifact = path.join(output, "index.scip");
      await this.run(
        this.options.command.command,
        [...this.options.command.args, ...this.options.indexArgs(artifact)],
        signal,
      );
      if (!fs.existsSync(artifact)) {
        throw new Error(
          `${this.options.provider}: the indexer exited without writing ${artifact}`,
        );
      }
      const json = await this.run(
        this.options.decode.command,
        [...this.options.decode.args, artifact],
        signal,
      );
      const index = parseScipIndex(JSON.parse(json), this.options.provider);
      this.assertProjectRoot(index.metadata.projectRoot);
      const adapted = adaptScipIndex({
        index,
        root: this.root,
        provider: this.options.provider,
        languages: this.languages,
        languageOf: this.options.languageOf,
      });
      const manifest = this.manifest(index, adapted.files);
      const after = this.fingerprint();
      if (after !== universe) {
        throw new Error(
          `${this.options.provider}: project inputs changed while the SCIP artifact was being built, so that artifact cannot be published`,
        );
      }
      return {
        languages: [...this.languages],
        nodes: adapted.nodes,
        edges: adapted.edges,
        diagnostics: adapted.diagnostics,
        sources: manifest.sources,
        provenance: {
          provider: this.options.provider,
          authority: this.options.authority,
          facts: [...adaptScipIndex.EDGE_KINDS],
          schemaVersion: SCIP_SCHEMA_VERSION,
          tool: index.metadata.toolInfo?.name ?? this.options.provider,
          toolVersion: index.metadata.toolInfo?.version ?? "",
          compilerVersion: "",
          protocolVersion: SCIP_PROTOCOL_VERSION,
          universe,
          capabilities: manifest.proven
            ? [...SCIP_CAPABILITIES, SOURCE_DIGESTS_CAPABILITY]
            : [...SCIP_CAPABILITIES],
        },
        warnings: manifest.proven
          ? adapted.warnings
          : [
              ...adapted.warnings,
              `${this.options.provider}: the index carries no document text, so its facts cannot be tied to the bytes they were computed from; source display falls back to what this graph can prove itself`,
            ],
      };
    } finally {
      fs.rmSync(output, { recursive: true, force: true });
    }
  }

  /**
   * The manifest for every file this index attributed facts to.
   *
   * `checkerDigest` is the ground truth for the facts — the bytes the indexer
   * actually resolved against — and this session can only supply it when the
   * index carries `Document.text`. When it does not, the field stays `""` and
   * the snapshot does not claim the `sourceDigests` capability.
   *
   * Hashing the disk here and calling the result a checker digest would be the
   * exact move `IBulkGraphSession.ISnapshot.sources` exists to forbid: the
   * bytes a later read returns are not the bytes the indexer saw, a write that
   * lands and reverts in between is invisible to both reads, and the resulting
   * digest would let a reader "prove" byte-identity against text the facts were
   * never computed from. An absent proof is a fact about this indexer; a
   * fabricated one is a lie about the program.
   */
  private manifest(
    index: IScipIndex,
    files: readonly string[],
  ): { sources: Map<string, IBulkGraphSession.ISourceDigest>; proven: boolean } {
    const indexed = new Map<string, string>();
    for (const document of index.documents) {
      const text = document.text;
      if (text !== undefined) {
        indexed.set(
          path.resolve(this.root, document.relativePath),
          createHash("sha256").update(text, "utf8").digest("hex"),
        );
      }
    }

    const sources = new Map<string, IBulkGraphSession.ISourceDigest>();
    let proven = files.length > 0;
    for (const file of files) {
      const absolute = path.resolve(this.root, file);
      const checkerDigest = indexed.get(absolute) ?? "";
      if (checkerDigest === "") proven = false;
      let diskDigest = "";
      try {
        diskDigest = createHash("sha256")
          .update(fs.readFileSync(absolute))
          .digest("hex");
        /* c8 ignore start -- a document the indexer read and that vanished
         * before this read is a race no hermetic fixture can stage. */
      } catch {
        diskDigest = "";
      }
      /* c8 ignore stop */
      sources.set(absolute, { checkerDigest, diskDigest });
    }
    return { sources, proven };
  }

  /**
   * The inputs that decide this index's file set, as one digest.
   *
   * Covers the provider's declared build inputs and every source file it owns.
   * A `go.mod` or `CMakeLists.txt` edit changes which files are in the program
   * without touching any of them, and a fingerprint that watched only source
   * extensions would call that project unchanged.
   */
  private fingerprint(): string {
    const hash = createHash("sha256");
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

  private assertProjectRoot(projectRoot: string): void {
    const declared = projectRoot.startsWith("file://")
      ? fileUriToPath(projectRoot)
      : projectRoot;
    if (!samePath(declared, this.root)) {
      throw new Error(
        `${this.options.provider}: the index was produced for ${declared}, not ${this.root}`,
      );
    }
  }

  /** Run one owned child to completion, returning its stdout. */
  private run(
    command: string,
    args: readonly string[],
    signal: AbortSignal | undefined,
  ): Promise<string> {
    if (signal?.aborted === true) {
      return Promise.reject(abortedProcessError(this.options.provider, command));
    }
    const child = spawn(command, [...args], {
      cwd: this.root,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Registered before the first await so `close` can reach this child even
    // if it is still starting: a session that only owned children it had
    // already heard from would leak exactly the ones that hang.
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
    // `abort` dispatches synchronously, so a signal that became aborted after
    // the first check but before listener registration must still retire this
    // child instead of letting an already-cancelled refresh run to completion.
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

export namespace ScipSession {
  export interface IOptions {
    root: string;
    languages: readonly GraphLanguage[];

    /** Registry name of the provider driving this session. */
    provider: string;

    authority: GraphProviderAuthority;

    /** The language-owned indexer. */
    command: { command: string; args: readonly string[] };

    /** The pinned helper that decodes a binary index to JSON. */
    decode: { command: string; args: readonly string[] };

    /** Arguments that direct the indexer's output to one isolated artifact. */
    indexArgs: (artifact: string) => string[];

    /** Every project-relative input whose change invalidates the artifact. */
    inputs: () => string[];

    languageOf: (file: string) => GraphLanguage;

    /** Maximum decoded stdout retained in memory; primarily lowered by tests. */
    maxStdoutBytes?: number;
  }
}

interface ISpawned {
  process: ReturnType<typeof spawn>;
  exit: Promise<undefined>;
  termination?: Promise<undefined>;
}

/**
 * A promise plus the function that settles it.
 *
 * The exit promise has to exist before the listener that settles it is
 * installed, so a caller can await a child it has just killed. Building it
 * inside the surrounding executor would shadow that executor's own `resolve`,
 * which reads as a bug even when it is not.
 */
function deferred(): { promise: Promise<undefined>; settle: () => void } {
  let settle!: () => void;
  const promise = new Promise<undefined>((resolve) => {
    settle = () => {
      resolve(undefined);
    };
  });
  return { promise, settle };
}

/** How long an owned child may ignore its termination signal. */
const TERMINATION_GRACE_MS = 1_000;

/** A decoder may be large, but it may never grow the process without bound. */
const DEFAULT_MAX_PROCESS_STDOUT_BYTES = 256 * 1024 * 1024;

/** Only the tail is useful in an error, and an indexer can log indefinitely. */
const MAX_PROCESS_STDERR_CHARS = 64 * 1024;

/** The dump body contract this session emits. */
const SCIP_SCHEMA_VERSION = 5;

/** SCIP's own protocol generation, as this client reads it. */
const SCIP_PROTOCOL_VERSION = 0;

/**
 * What every SCIP snapshot proves about itself.
 *
 * `universe` is claimed because the fingerprint covers the declared build
 * inputs, and `diskDigests` because this session hashes the files. Neither
 * `diagnostics` nor `sourceDigests` is here: SCIP carries diagnostics only
 * when the indexer chose to emit them, so claiming it would turn "this indexer
 * reports none" into "this project has none", and source digests depend on the
 * index carrying document text — which most indexers omit.
 */
const SCIP_CAPABILITIES: readonly string[] = ["universe", "diskDigests"];

/**
 * Claimed only when the index carried the text its facts were computed from.
 *
 * Naming it is what tells a reader they may compare their own read against
 * `checkerDigest` and conclude something. Claiming it without the text would
 * invite exactly the unsound proof the manifest refuses to fabricate.
 */
const SOURCE_DIGESTS_CAPABILITY = "sourceDigests";

function fileUriToPath(uri: string): string {
  const withoutScheme = uri.slice("file://".length).replace(/^\/(?=[a-zA-Z]:)/, "");
  return decodeURIComponent(withoutScheme);
}

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

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  // Only one arm runs on a given operating system.
  /* c8 ignore next 3 */
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function compareOrdinalPath(left: string, right: string): number {
  /* c8 ignore next 2 -- input lists hold distinct project-relative paths. */
  return left < right ? -1 : left > right ? 1 : 0;
}
