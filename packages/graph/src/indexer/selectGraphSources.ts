import { GraphLanguage } from "../typings";
import { walkSourceFiles } from "../utils/fs";
import { allExtensions } from "./allExtensions";
import { IBuildGraphOptions } from "./IBuildGraphOptions";
import { languageOf } from "./languageOf";
import { specOf } from "./specOf";

export interface IGraphSourceSelection {
  /** Requested languages, deduplicated in caller order; discovery uses files. */
  languages: GraphLanguage[];
  /** Languages actually represented by the globally capped source set. */
  presentLanguages: GraphLanguage[];
  /** One deterministic global source set, before it is partitioned by language. */
  files: string[];
  /** The selected files that belong to each discovered/requested language. */
  byLanguage: Map<GraphLanguage, string[]>;
}

/**
 * Select the source snapshot once for an index build or resident refresh.
 *
 * `maxFiles` bounds this one walk, never each language's private walk.  The
 * resulting paths are then partitioned so the static, LSP, and hybrid lanes
 * reason about exactly the same snapshot.
 */
export function selectGraphSources(
  root: string,
  options: IBuildGraphOptions,
): IGraphSourceSelection {
  const requested = normalizeRequestedLanguages(options.languages);
  const files = walkSourceFiles(root, {
    extensions: allExtensions(requested),
    maxFiles: options.maxFiles,
  });
  const byLanguage = new Map<GraphLanguage, string[]>();
  for (const file of files) {
    const language = languageOf(file);
    const partition = byLanguage.get(language);
    if (partition === undefined) byLanguage.set(language, [file]);
    else partition.push(file);
  }
  const presentLanguages = [...byLanguage.keys()];
  return {
    languages: requested ?? presentLanguages,
    presentLanguages,
    files,
    byLanguage,
  };
}

/** Reject runtime values outside the public language registry before a walk. */
export function normalizeRequestedLanguages(
  languages: readonly GraphLanguage[] | undefined,
): GraphLanguage[] | undefined {
  if (languages === undefined) return undefined;
  const normalized: GraphLanguage[] = [];
  for (const language of languages) {
    if (typeof language !== "string" || specOf(language) === undefined) {
      throw new Error(
        `@samchon/graph: unsupported explicit language: ${String(language)}`,
      );
    }
    if (!normalized.includes(language)) normalized.push(language);
  }
  return normalized;
}
