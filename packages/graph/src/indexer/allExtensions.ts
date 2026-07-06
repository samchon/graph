import { GraphLanguage } from "../structures";
import { LANGUAGE_SPECS } from "./LANGUAGE_SPECS";

export function allExtensions(languages?: readonly GraphLanguage[]): Set<string> {
  const allowed = languages === undefined ? undefined : new Set(languages);
  const out = new Set<string>();
  for (const spec of LANGUAGE_SPECS) {
    if (allowed !== undefined && !allowed.has(spec.language)) continue;
    for (const ext of spec.extensions) out.add(ext);
  }
  return out;
}
