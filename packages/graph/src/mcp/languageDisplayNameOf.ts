import { GraphLanguage } from "../typings";

const DISPLAY_NAMES: Record<Exclude<GraphLanguage, "unknown">, string> = {
  typescript: "TypeScript",
  go: "Go",
  rust: "Rust",
  cpp: "C++",
  c: "C",
  java: "Java",
  csharp: "C#",
  kotlin: "Kotlin",
  swift: "Swift",
  scala: "Scala",
  zig: "Zig",
  python: "Python",
  ruby: "Ruby",
  php: "PHP",
  lua: "Lua",
  dart: "Dart",
};

/**
 * The tool description names the active language by its proper display name
 * when a session indexes exactly one (mirroring how the TypeScript-only
 * predecessor confidently named "TypeScript" throughout); a session spanning
 * zero or several languages falls back to the generic "code".
 */
export function languageDisplayNameOf(
  languages: readonly GraphLanguage[],
): string {
  const known = [...new Set(languages)].filter(
    (language): language is Exclude<GraphLanguage, "unknown"> =>
      language !== "unknown",
  );
  return known.length === 1 ? DISPLAY_NAMES[known[0]!] : "code";
}
