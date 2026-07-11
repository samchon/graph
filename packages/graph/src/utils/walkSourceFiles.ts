import fs from "node:fs";
import path from "node:path";
import { DEFAULT_IGNORES } from "./DEFAULT_IGNORES";
import { IWalkOptions } from "./IWalkOptions";

export function walkSourceFiles(root: string, options: IWalkOptions): string[] {
  const out: string[] = [];
  const ignoreDirs = options.ignoreDirs ?? DEFAULT_IGNORES;
  const visit = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!ignoreDirs.has(entry.name)) visit(abs);
        continue;
      }
      /* c8 ignore next */
      if (!entry.isFile()) continue;
      // `.d.ts` declaration files end in `.ts` (path.extname keeps only the
      // last dot segment), so without this check a compiled `lib/*.d.ts`
      // output tree would be indexed as if it were real TypeScript source.
      if (entry.name.endsWith(".d.ts")) continue;
      if (options.extensions.has(path.extname(entry.name).toLowerCase())) {
        out.push(abs);
      }
    }
  };
  visit(path.resolve(root));
  return out;
}
