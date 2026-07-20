import { GraphLanguage } from "../typings";
import { IBuildGraphOptions } from "./IBuildGraphOptions";
import { selectGraphSources } from "./selectGraphSources";

export function discoverLanguages(
  root: string,
  options: IBuildGraphOptions,
): GraphLanguage[] {
  return selectGraphSources(root, options).presentLanguages;
}
