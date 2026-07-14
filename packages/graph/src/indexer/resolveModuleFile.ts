import { GraphLanguage } from "../typings";
import { dirname, normalizePath } from "../utils/path";

/** Filename suffixes a bare TypeScript/JavaScript specifier may resolve to. */
const TS_SUFFIXES = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  "/index.ts",
  "/index.tsx",
  "/index.js",
  "/index.jsx",
];

/**
 * The project file a re-export specifier names, or undefined when it names
 * something outside the project (a dependency) or nothing the walk found.
 *
 * This is deliberately the module resolution the *export syntax* needs and no
 * more: only a re-export chain that stays inside the project can add a module
 * to a project symbol's wire, so a bare package specifier resolves to nothing
 * and costs the surface count nothing.
 */
export function resolveModuleFile(
  language: GraphLanguage,
  from: string,
  specifier: string,
  files: ReadonlySet<string>,
): string | undefined {
  if (language === "typescript") {
    if (!specifier.startsWith(".")) return undefined;
    const base = joinRelative(dirname(from), specifier);
    for (const suffix of TS_SUFFIXES) {
      const candidate = `${base}${suffix}`;
      if (files.has(candidate)) return candidate;
    }
    return undefined;
  }
  if (language === "python") {
    // `.` is the package itself, `.order` a sibling module, `..shared` the
    // parent package: one leading dot means "here", each extra one climbs.
    const dots = /^\.+/.exec(specifier)?.[0].length ?? 0;
    if (dots === 0) return undefined;
    let dir = dirname(from);
    for (let i = 1; i < dots; i++) dir = dirname(dir);
    const tail = specifier.slice(dots).split(".").filter(Boolean);
    const base = [dir, ...tail].filter((part) => part !== ".").join("/");
    for (const suffix of [".py", "/__init__.py"]) {
      const candidate = `${base}${suffix}`;
      if (files.has(candidate)) return candidate;
    }
    return undefined;
  }
  if (language === "rust") {
    const segments = specifier
      .split("::")
      .map((segment) => segment.trim())
      .filter((segment) => segment !== "" && segment !== "crate");
    // `self::x` is relative to the declaring module, `super::x` to its parent;
    // anything else is rooted at the crate.
    let dir = "";
    let index = 0;
    if (segments[0] === "self" || segments[0] === "super") {
      dir = dirname(from);
      while (segments[index] === "self" || segments[index] === "super") {
        if (segments[index] === "super") dir = dirname(dir);
        index++;
      }
    } else {
      dir = crateRootOf(from);
    }
    // A path can name a module or an item inside one, and only the walk knows
    // which: try the longest prefix first and shorten until a file answers.
    for (let end = segments.length; end > index; end--) {
      const base = [dir, ...segments.slice(index, end)]
        .filter((part) => part !== "" && part !== ".")
        .join("/");
      for (const suffix of [".rs", "/mod.rs"]) {
        const candidate = `${base}${suffix}`;
        if (files.has(candidate)) return candidate;
      }
    }
    return undefined;
  }
  return undefined;
}

/** The crate root a Rust file lives under: everything up to and including `src`. */
function crateRootOf(from: string): string {
  const parts = normalizePath(from).split("/");
  const src = parts.lastIndexOf("src");
  return src < 0 ? "" : parts.slice(0, src + 1).join("/");
}

/** Resolve `./x`, `../x` against a project-relative directory. */
function joinRelative(dir: string, specifier: string): string {
  const parts = dir === "." ? [] : normalizePath(dir).split("/");
  for (const segment of normalizePath(specifier).split("/")) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}
