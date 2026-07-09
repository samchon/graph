import path from "node:path";
import { GraphLanguage } from "../typings";
import { LANGUAGE_SPECS } from "./LANGUAGE_SPECS";

export function languageOf(file: string): GraphLanguage {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".h") return "c";
  for (const spec of LANGUAGE_SPECS) {
    if (spec.extensions.includes(ext)) return spec.language;
  }
  return "unknown";
}
