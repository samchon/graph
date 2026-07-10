import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * clangd walks up from each open file's directory looking for
 * `compile_commands.json`; without one it falls back to guessed compile
 * flags, which silently drops out-of-line member bodies that need real
 * include paths to parse (confirmed: a C++ project's `.cc` definitions were
 * absent from the graph even though its headers indexed fine).
 *
 * If the project doesn't already have a compilation database but configures
 * CMake, do a best-effort `-DCMAKE_EXPORT_COMPILE_COMMANDS=ON` configure into
 * a throwaway directory and return it so the caller can point clangd at it
 * via `--compile-commands-dir`, without writing anything into the project.
 * Any failure (no cmake on PATH, a non-CMake build system, a configure
 * error, a slow configure) is swallowed — this is strictly best-effort.
 */
export function ensureCompileCommands(
  root: string,
  cmakeCommand: readonly string[] = ["cmake"],
): string | undefined {
  if (hasCompileCommands(root)) return undefined;
  if (!fs.existsSync(path.join(root, "CMakeLists.txt"))) return undefined;
  const buildDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "samchon-graph-cmake-"),
  );
  const result = spawnSync(
    cmakeCommand[0]!,
    [
      ...cmakeCommand.slice(1),
      "-S",
      root,
      "-B",
      buildDir,
      "-DCMAKE_EXPORT_COMPILE_COMMANDS=ON",
    ],
    { timeout: 60_000, stdio: "ignore" },
  );
  if (result.error !== undefined || result.status !== 0) return undefined;
  return fs.existsSync(path.join(buildDir, "compile_commands.json"))
    ? buildDir
    : undefined;
}

function hasCompileCommands(root: string): boolean {
  return (
    fs.existsSync(path.join(root, "compile_commands.json")) ||
    fs.existsSync(path.join(root, "build", "compile_commands.json"))
  );
}
