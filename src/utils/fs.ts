import fs from "node:fs";
import path from "node:path";

import { normalizePath, relativePath } from "./path";

const DEFAULT_IGNORES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".idea",
  ".vscode",
  "node_modules",
  "bower_components",
  "vendor",
  "dist",
  "build",
  "target",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
]);

export interface IWalkOptions {
  extensions: ReadonlySet<string>;
  ignoreDirs?: ReadonlySet<string>;
  maxFiles?: number;
}

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
      if (!entry.isFile()) continue;
      if (options.extensions.has(path.extname(entry.name).toLowerCase())) {
        out.push(abs);
      }
    }
  };
  visit(path.resolve(root));
  return out;
}

export function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

export function readLines(file: string): string[] | undefined {
  return readText(file)?.split(/\r?\n/);
}

export function projectRelative(root: string, file: string): string {
  return normalizePath(relativePath(root, file));
}
