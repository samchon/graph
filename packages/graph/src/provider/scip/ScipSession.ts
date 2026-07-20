import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { GraphLanguage, GraphProviderAuthority } from "../../typings";
import { IBulkGraphSession } from "../IBulkGraphSession";
import { adaptScipIndex, SCIP_EDGE_KINDS } from "./adaptScipIndex";
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
  private readonly children = new Set<ISpawned>();
  private snapshot: IBulkGraphSession.ISnapshot | undefined;
  private universe = "";
  private version = 0;
  private closed = false;
  private queue: Promise<void> = Promise.resolve();

  public constructor(options: ScipSession.IOptions) {
    if (options.languages.length === 0) {
      throw new TypeError("scip: a session must own at least one language");
    }
    this.options = options;
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
    });
  }

  public async close(): Promise<void> {
    this.closed = true;
    // Only the exact objects this session spawned. Nothing here scans the
    // process table or matches on a name: another copy of the same indexer
    // belongs to somebody else.
    const owned = [...this.children];
    this.children.clear();
    for (const child of owned) {
      child.process.kill();
      await child.exit;
    }
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
      return {
        languages: [...this.languages],
        nodes: adapted.nodes,
        edges: adapted.edges,
        diagnostics: adapted.diagnostics,
        sources: this.manifest(adapted.files),
        provenance: {
          provider: this.options.provider,
          authority: this.options.authority,
          facts: [...SCIP_EDGE_KINDS],
          schemaVersion: SCIP_SCHEMA_VERSION,
          tool: index.metadata.toolInfo?.name ?? this.options.provider,
          toolVersion: index.metadata.toolInfo?.version ?? "",
          compilerVersion: "",
          protocolVersion: SCIP_PROTOCOL_VERSION,
          universe,
          capabilities: [...SCIP_CAPABILITIES],
        },
        warnings: adapted.warnings,
      };
    } finally {
      fs.rmSync(output, { recursive: true, force: true });
    }
  }

  /**
   * The digest a reader can reproduce for every file this index attributed
   * facts to.
   *
   * A SCIP indexer states which documents it read but not what they hashed to,
   * so the digest is taken here, from the same bytes the mapping was validated
   * against. Both digests are the disk digest because they are the same read:
   * unlike a compiler with a source-preamble plugin, a SCIP indexer has no
   * separate notion of augmented text to distinguish them.
   */
  private manifest(
    files: readonly string[],
  ): Map<string, IBulkGraphSession.ISourceDigest> {
    const manifest = new Map<string, IBulkGraphSession.ISourceDigest>();
    for (const file of files) {
      const absolute = path.resolve(this.root, file);
      let digest = "";
      try {
        digest = createHash("sha256")
          .update(fs.readFileSync(absolute))
          .digest("hex");
        /* c8 ignore start -- a document the indexer read and that vanished
         * before this read is a race no hermetic fixture can stage. */
      } catch {
        digest = "";
      }
      /* c8 ignore stop */
      manifest.set(absolute, { checkerDigest: digest, diskDigest: digest });
    }
    return manifest;
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
    for (const file of this.options.inputs().sort(compareOrdinalPath)) {
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
    if (path.resolve(declared) !== path.resolve(this.root)) {
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
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const abort = (): void => {
      child.kill();
    };
    signal?.addEventListener("abort", abort, { once: true });

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
          const error = new Error(
            `${this.options.provider}: ${command} was aborted`,
          );
          error.name = "AbortError";
          reject(error);
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

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    let settle!: (value: T) => void;
    let fail!: (error: Error) => void;
    const result = new Promise<T>((resolve, reject) => {
      settle = resolve;
      fail = reject;
    });
    this.queue = this.queue
      .catch(() => undefined)
      .then(async () => {
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
  }
}

interface ISpawned {
  process: ReturnType<typeof spawn>;
  exit: Promise<undefined>;
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

/** The dump body contract this session emits. */
const SCIP_SCHEMA_VERSION = 5;

/** SCIP's own protocol generation, as this client reads it. */
const SCIP_PROTOCOL_VERSION = 0;

/**
 * What a SCIP snapshot proves about itself.
 *
 * `sourceDigests` and `diskDigests` are both claimed because this session
 * hashes the documents itself. `universe` is claimed because the fingerprint
 * covers the declared build inputs. `diagnostics` is not: SCIP carries them
 * only when the indexer chose to emit them, and claiming the capability would
 * turn "this indexer reports none" into "this project has none".
 */
const SCIP_CAPABILITIES: readonly string[] = [
  "universe",
  "sourceDigests",
  "diskDigests",
];

function fileUriToPath(uri: string): string {
  const withoutScheme = uri.slice("file://".length).replace(/^\/(?=[a-zA-Z]:)/, "");
  return decodeURIComponent(withoutScheme);
}

function compareOrdinalPath(left: string, right: string): number {
  /* c8 ignore next 2 -- input lists hold distinct project-relative paths. */
  return left < right ? -1 : left > right ? 1 : 0;
}
