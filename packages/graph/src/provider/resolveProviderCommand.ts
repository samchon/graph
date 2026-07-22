import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { IGraphProvider } from "./IGraphProvider";

/** Resolve a sidecar/indexer project-locally before consulting PATH. */
export function resolveProviderCommand(
  root: string,
  env: NodeJS.ProcessEnv,
  props: resolveProviderCommand.IProps,
): IGraphProvider.ICommand | undefined {
  const override = env[props.override];
  if (
    override !== undefined &&
    path.isAbsolute(override) &&
    isSpawnableFile(override)
  ) {
    return spawnable(override, props.args);
  }

  for (const candidate of localCandidates(root, props.command)) {
    if (isSpawnableFile(candidate)) return spawnable(candidate, props.args);
  }

  const onPath = resolveOnPath(props.command, root, env);
  return onPath === undefined ? undefined : spawnable(onPath, props.args);
}

export namespace resolveProviderCommand {
  export interface IProps {
    command: string;
    override: string;
    args?: readonly string[];
  }
}

function resolveOnPath(
  command: string,
  root: string,
  env: NodeJS.ProcessEnv,
): string | undefined {
  /* c8 ignore start -- each CI operating system exercises its native lookup. */
  const lookup =
    process.platform === "win32"
      ? path.join(
          process.env.SystemRoot ?? "C:\\Windows",
          "System32",
          "where.exe",
        )
      : "command";
  const args = process.platform === "win32" ? [command] : ["-v", command];
  const shell = process.platform !== "win32";
  /* c8 ignore stop */
  const result = spawnSync(lookup, args, {
    cwd: root,
    encoding: "utf8",
    env,
    shell,
    windowsHide: true,
  });
  if (result.status !== 0) return undefined;
  const lines = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  /* c8 ignore start -- Windows prefers native binaries before command shims;
   * POSIX has one executable identity. */
  if (process.platform === "win32") {
    const native = lines.filter((line) => /\.exe$/i.test(line));
    const shim = lines.filter((line) => /\.(?:cmd|bat)$/i.test(line));
    return [...native, ...shim, ...lines][0];
  }
  /* c8 ignore stop */
  return lines[0];
}

function localCandidates(root: string, command: string): string[] {
  const privateBin = path.join(root, ".samchon-graph", "bin");
  const packageBin = path.join(root, "node_modules", ".bin");
  /* c8 ignore start -- each CI operating system exercises its native arm. */
  return process.platform === "win32"
    ? [
        path.join(privateBin, `${command}.exe`),
        path.join(privateBin, `${command}.cmd`),
        path.join(privateBin, `${command}.bat`),
        path.join(packageBin, `${command}.exe`),
        path.join(packageBin, `${command}.cmd`),
        path.join(packageBin, `${command}.bat`),
      ]
    : [path.join(privateBin, command), path.join(packageBin, command)];
  /* c8 ignore stop */
}

function isSpawnableFile(file: string): boolean {
  try {
    if (!fs.statSync(file).isFile()) return false;
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function spawnable(
  executable: string,
  args: readonly string[] = [],
): IGraphProvider.ICommand {
  /* c8 ignore start -- Windows exercises its command shim and POSIX its
   * directly executable file in the same cross-platform test. */
  return process.platform === "win32" && /\.(?:cmd|bat)$/i.test(executable)
    ? {
        command: "cmd.exe",
        args: ["/d", "/s", "/c", executable, ...args],
      }
    : { command: executable, args: [...args] };
  /* c8 ignore stop */
}
