import { GraphLanguage } from "../typings";
import { basename } from "../utils/path";
import { IReexport } from "./IReexport";

/**
 * The re-export statements a source file writes.
 *
 * A barrel is why the export surface is a count and not a flag: the name a
 * consumer imports from the package has been forwarded up a chain of files, and
 * each link is one more module that puts it on the wire. Without a checker the
 * links come from the export syntax itself, which is why this is per-language
 * and why a language with no re-export form simply has none — the symbol still
 * carries the edge from the file that declares it (see {@link exportEdges}).
 * Degrade per language, not per tour.
 */
export function reexportsOf(
  language: GraphLanguage,
  file: string,
  text: string,
): IReexport[] {
  if (language === "typescript") return typescriptReexports(text);
  if (language === "python") return pythonReexports(file, text);
  if (language === "rust") return rustReexports(text);
  return [];
}

/**
 * `export * from "./order"` forwards everything; `export { a, b as c } from
 * "./order"` forwards `a` and `b` — the names as the *target* spells them, so
 * the local alias after `as` is dropped.
 *
 * `export * as ns from "./order"` is deliberately not a re-export: it publishes
 * one namespace object, not the names inside it, so nothing the target declares
 * gains a module on its wire.
 */
function typescriptReexports(text: string): IReexport[] {
  const out: IReexport[] = [];
  const star = /(?:^|[\n;])\s*export\s+\*\s+from\s+["']([^"']+)["']/g;
  for (let m = star.exec(text); m !== null; m = star.exec(text)) {
    out.push({ specifier: m[1]! });
  }
  const named =
    /(?:^|[\n;])\s*export\s+(?:type\s+)?\{([^}]*)\}\s*from\s+["']([^"']+)["']/g;
  for (let m = named.exec(text); m !== null; m = named.exec(text)) {
    const names = namesOf(m[1]!);
    if (names.length > 0) out.push({ specifier: m[2]!, names });
  }
  return out;
}

/**
 * A package's `__init__.py` is Python's barrel: `from .order import Order`
 * re-exports `Order` under the package's own name. An ordinary module's imports
 * are imports, not a published surface, so only the package initializer counts.
 */
function pythonReexports(file: string, text: string): IReexport[] {
  if (basename(file) !== "__init__.py") return [];
  const out: IReexport[] = [];
  const from = /(?:^|\n)\s*from\s+(\.[\w.]*)\s+import\s+([^\n#]+)/g;
  for (let m = from.exec(text); m !== null; m = from.exec(text)) {
    const clause = m[2]!.trim();
    if (clause.startsWith("*")) {
      out.push({ specifier: m[1]! });
      continue;
    }
    const names = namesOf(clause.replace(/^\(/, "").replace(/\)$/, ""));
    if (names.length > 0) out.push({ specifier: m[1]!, names });
  }
  return out;
}

/**
 * `pub use crate::order::Order;` is Rust's re-export, and `pub use
 * crate::order::*;` its barrel. A braced group (`pub use crate::order::{A, B}`)
 * forwards each name in it.
 */
function rustReexports(text: string): IReexport[] {
  const out: IReexport[] = [];
  const use = /(?:^|[\n;])\s*pub\s+use\s+([^;]+);/g;
  for (let m = use.exec(text); m !== null; m = use.exec(text)) {
    const clause = m[1]!.trim();
    const braced = /^(.*?)::\{([^}]*)\}$/.exec(clause);
    if (braced !== null) {
      const names = namesOf(braced[2]!);
      if (names.length > 0) out.push({ specifier: braced[1]!, names });
      continue;
    }
    const path = clause.split(/\s+as\s+/)[0]!.trim();
    const cut = path.lastIndexOf("::");
    if (cut < 0) continue;
    const last = path.slice(cut + 2);
    if (last === "*") out.push({ specifier: path.slice(0, cut) });
    else out.push({ specifier: path.slice(0, cut), names: [last] });
  }
  return out;
}

/**
 * The identifiers a comma-separated clause names, as the module they come from
 * spells them: the local alias a re-export binds them to (`b as c`) is this
 * file's name for the symbol, not the one the target declared.
 */
function namesOf(clause: string): string[] {
  const out: string[] = [];
  for (const raw of clause.split(",")) {
    const entry = raw.trim().replace(/^type\s+/, "");
    if (entry === "") continue;
    const name = entry.split(/\s+as\s+/)[0]?.trim();
    if (name !== undefined && /^[A-Za-z_$][\w$]*$/.test(name)) out.push(name);
  }
  return out;
}
