import { GraphLanguage } from "../typings";
import { walkSourceFiles } from "../utils/fs";
import { allExtensions } from "./allExtensions";
import { IBuildGraphOptions } from "./IBuildGraphOptions";
import { IGraphSourceSelection } from "./IGraphSourceSelection";
import { languageOf } from "./languageOf";
import { normalizeRequestedLanguages } from "./normalizeRequestedLanguages";

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
