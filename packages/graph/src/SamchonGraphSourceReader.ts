import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { IBulkGraphSession } from "./provider/IBulkGraphSession";
import { isSubPath, normalizePath } from "./utils/path";

type ReadFile = (file: string) => Buffer;

/** Immutable source lines adjudicated for one graph snapshot. */
export class SamchonGraphSourceReader {
  private readonly project: string;
  private readonly texts: ReadonlyMap<string, string>;
  private readonly checkerDigests: ReadonlyMap<string, string>;
  private readonly allowUnproven: boolean;
  private readonly read: ReadFile;
  private readonly cache = new Map<string, readonly string[] | undefined>();

  public constructor(
    project: string,
    options: SamchonGraphSourceReader.IOptions = {},
  ) {
    this.project = path.resolve(project);
    this.texts = normalizeTexts(this.project, options.texts);
    this.checkerDigests = normalizeDigests(
      this.project,
      options.digests,
    );
    this.allowUnproven = options.allowUnproven === true;
    this.read = options.read ?? ((file) => fs.readFileSync(file));
  }

  /** A compatibility reader that freezes the first in-project disk read. */
  public static live(project: string): SamchonGraphSourceReader {
    return new SamchonGraphSourceReader(project, { allowUnproven: true });
  }

  /** A fail-closed reader for dumps that carry no source provenance. */
  public static none(project: string): SamchonGraphSourceReader {
    return new SamchonGraphSourceReader(project);
  }

  /**
   * Return frozen lines only for a confined file belonging to this snapshot.
   * Exact consumed text wins; otherwise a disk read must match checkerDigest.
   */
  public lines(file: string): readonly string[] | undefined {
    const key = graphFileOf(file);
    if (this.cache.has(key)) return this.cache.get(key);
    const absolute = path.resolve(this.project, key);
    if (!isSubPath(this.project, absolute)) {
      this.cache.set(key, undefined);
      return undefined;
    }

    const exact = this.texts.get(key);
    if (exact !== undefined) return this.remember(key, exact);

    if (!confinedOnDisk(this.project, absolute)) {
      this.cache.set(key, undefined);
      return undefined;
    }

    const expected = this.checkerDigests.get(key);
    if (expected === undefined && !this.allowUnproven) {
      this.cache.set(key, undefined);
      return undefined;
    }
    let text: string;
    try {
      text = this.read(absolute).toString("utf8");
    } catch {
      this.cache.set(key, undefined);
      return undefined;
    }
    if (expected !== undefined && sha256(text) !== expected) {
      this.cache.set(key, undefined);
      return undefined;
    }
    return this.remember(key, text);
  }

  private remember(key: string, text: string): readonly string[] {
    const lines: readonly string[] = Object.freeze(text.split(/\r?\n/));
    this.cache.set(key, lines);
    return lines;
  }
}

export namespace SamchonGraphSourceReader {
  export interface IOptions {
    /** Exact texts consumed by generic LSP/static lanes, keyed by any path form. */
    texts?: ReadonlyMap<string, string>;
    /** Compiler snapshot digests, keyed by any path form. */
    digests?: ReadonlyMap<string, IBulkGraphSession.ISourceDigest>;
    /** Compatibility mode for direct in-memory API callers only. */
    allowUnproven?: boolean;
    /** Test seam for deterministic read/failure/cache coverage. */
    read?: ReadFile;
  }
}

function normalizeTexts(
  project: string,
  input: ReadonlyMap<string, string> | undefined,
): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const [file, text] of input ?? []) out.set(relativeKey(project, file), text);
  return out;
}

function normalizeDigests(
  project: string,
  input:
    | ReadonlyMap<string, IBulkGraphSession.ISourceDigest>
    | undefined,
): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const [file, digest] of input ?? []) {
    if (digest.checkerDigest !== "") {
      out.set(relativeKey(project, file), digest.checkerDigest);
    }
  }
  return out;
}

function relativeKey(project: string, file: string): string {
  return graphFileOf(
    path.isAbsolute(file) ? path.relative(project, file) : file,
  );
}

function graphFileOf(file: string): string {
  return normalizePath(file);
}

function confinedOnDisk(project: string, candidate: string): boolean {
  try {
    return isSubPath(fs.realpathSync(project), fs.realpathSync(candidate));
  } catch {
    return false;
  }
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
