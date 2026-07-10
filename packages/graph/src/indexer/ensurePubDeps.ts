import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * The Dart analysis server can only resolve a package's own dependencies —
 * and therefore analyze anything under that package's `lib/` beyond
 * dependency-free scripts — once `.dart_tool/package_config.json` exists,
 * which only `dart pub get` produces. A pub workspace with several
 * `pubspec.yaml` roots (common in Dart/Flutter monorepos) needs this run once
 * per package; without it, real library code looks unindexed and only
 * standalone tests/examples resolve (confirmed: a Dart monorepo's actual
 * package sources had zero graph nodes while its test/example scaffolding
 * indexed fine).
 *
 * Runs best-effort, per package, and never throws: a network-less box, a
 * missing `dart` binary, or one broken package among many all just leave
 * that package's dependencies unresolved rather than failing the build. Only
 * runs when `.dart_tool/package_config.json` is absent, so an
 * already-bootstrapped project (the common case) is never touched.
 */
export function ensurePubDeps(
  root: string,
  pubCommand: readonly string[] = ["dart"],
): void {
  for (const pubspecDir of findPubspecDirs(root)) {
    if (
      fs.existsSync(
        path.join(pubspecDir, ".dart_tool", "package_config.json"),
      )
    )
      continue;
    spawnSync(pubCommand[0]!, [...pubCommand.slice(1), "pub", "get"], {
      cwd: pubspecDir,
      timeout: 120_000,
      stdio: "ignore",
    });
  }
}

function findPubspecDirs(root: string, depth = 0): string[] {
  if (depth > 4) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = entries.some(
    (entry) => entry.isFile() && entry.name === "pubspec.yaml",
  )
    ? [root]
    : [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name)) continue;
    out.push(...findPubspecDirs(path.join(root, entry.name), depth + 1));
  }
  return out;
}

const IGNORED_DIRS = new Set(["build", "node_modules"]);
