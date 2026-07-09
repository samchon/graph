import fs from "node:fs";
import path from "node:path";
import { DEFAULT_IGNORES } from "./DEFAULT_IGNORES";
import { IWalkOptions } from "./IWalkOptions";

export function walkSourceFiles(root: string, options: IWalkOptions): string[] {
  const out: string[] = [];
  const ignoreDirs = options.ignoreDirs ?? DEFAULT_IGNORES;
  const visit = (dir: string): void => {
    if (options.maxFiles !== undefined && out.length >= options.maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (options.maxFiles !== undefined && out.length >= options.maxFiles) break;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!ignoreDirs.has(entry.name)) visit(abs);
        continue;
      }
      /* c8 ignore next */
      if (!entry.isFile()) continue;
      if (options.extensions.has(path.extname(entry.name).toLowerCase())) {
        out.push(abs);
      }
    }
  };
  visit(path.resolve(root));
  return out;
}
