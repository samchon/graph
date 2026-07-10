import { GraphLanguage } from "../typings";
import { walkSourceFiles } from "../utils/fs";
import { IBuildGraphOptions } from "./IBuildGraphOptions";
import { allExtensions, languageOf } from "./languages";

export function discoverLanguages(
  root: string,
  options: IBuildGraphOptions,
): GraphLanguage[] {
  const files = walkSourceFiles(root, {
    extensions: allExtensions(options.languages),
    maxFiles: options.maxFiles,
  });
  return [
    ...new Set(files.map(languageOf).filter((language) => language !== "unknown")),
  ];
}
