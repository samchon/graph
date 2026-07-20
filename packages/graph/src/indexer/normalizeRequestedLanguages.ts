import { GraphLanguage } from "../typings";
import { specOf } from "./specOf";

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
