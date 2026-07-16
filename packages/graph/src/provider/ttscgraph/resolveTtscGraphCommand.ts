import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

interface ITtscGraphCommand {
  command: string;
  args: string[];
}

/** Resolve the native `ttscgraph` binary without adding a runtime dependency. */
export function resolveTtscGraphCommand(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): ITtscGraphCommand | undefined {
  const override = env.TTSC_GRAPH_BINARY;
  if (
    override !== undefined &&
    path.isAbsolute(override) &&
    isSpawnableFile(override)
  ) {
    return spawnable(override);
  }

  // Match @ttsc/graph's canonical precedence: the target project's `ttsc`
  // installation owns the compatible platform binary. A stale global command
  // must never shadow it merely because it appears first on PATH.
  const projectPackage = resolveProjectTtscPackage(root);
  if (projectPackage !== undefined) {
    const binary = platformBinaryOf(projectPackage);
    if (binary !== undefined) return spawnable(binary);
  }

  // A package-manager shim can still reveal the project installation when its
  // package metadata is not directly resolvable (for example, an unusual
  // linked layout). Search only the target project's .bin at this stage.
  const projectServer = resolveExecutable("ttscserver", root, env, false);
  if (projectServer !== undefined) {
    const beside = graphBesideServer(projectServer);
    if (beside !== undefined) return beside;
  }

  // Only after project-owned candidates fail may PATH/global installations be
  // used as a compatibility fallback.
  const onPath = resolveExecutable("ttscgraph", root, env, true);
  if (onPath !== undefined) return spawnable(onPath);

  const globalServer = resolveExecutable("ttscserver", root, env, true);
  if (globalServer !== undefined && globalServer !== projectServer) {
    return graphBesideServer(globalServer);
  }
  return undefined;
}

function resolveProjectTtscPackage(root: string): string | undefined {
  try {
    return createRequire(
      path.join(path.resolve(root), "__samchon_graph_resolver__.cjs"),
    ).resolve("ttsc/package.json");
  } catch {
    return undefined;
  }
}

function platformBinaryOf(ttscPackage: string): string | undefined {
  const packageName = `@ttsc/${process.platform}-${process.arch}`;
  const executable = process.platform === "win32" ? "ttscgraph.exe" : "ttscgraph";
  try {
    const resolver = createRequire(ttscPackage);
    const binary = resolver.resolve(`${packageName}/bin/${executable}`);
    return isSpawnableFile(binary) ? binary : undefined;
  } catch {
    return undefined;
  }
}

function graphBesideServer(server: string): ITtscGraphCommand | undefined {
  const sibling = path.join(
    path.dirname(server),
    process.platform === "win32" ? "ttscgraph.exe" : "ttscgraph",
  );
  if (isSpawnableFile(sibling)) return spawnable(sibling);
  for (const candidate of ttscPackagesBeside(server)) {
    if (!fs.existsSync(candidate)) continue;
    const binary = platformBinaryOf(candidate);
    if (binary !== undefined) return spawnable(binary);
  }
  return undefined;
}

function resolveExecutable(
  command: string,
  root: string,
  env: NodeJS.ProcessEnv,
  includeGlobal: boolean,
): string | undefined {
  const lookup = process.platform === "win32" ? "where.exe" : "command";
  const args = process.platform === "win32" ? [command] : ["-v", command];
  const projectBin = path.join(root, "node_modules", ".bin");
  const inheritedPath = includeGlobal ? env.PATH ?? "" : "";
  const result = spawnSync(lookup, args, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...env,
      PATH:
        inheritedPath === ""
          ? projectBin
          : `${projectBin}${path.delimiter}${inheritedPath}`,
    },
    shell: process.platform !== "win32",
    windowsHide: true,
  });
  if (result.status !== 0) return undefined;
  const lines = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (process.platform !== "win32") return lines[0];
  const executable = lines.filter((line) => /\.exe$/i.test(line));
  const commandShim = lines.filter((line) => /\.(?:cmd|bat)$/i.test(line));
  return [...executable, ...commandShim, ...lines][0];
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

function spawnable(executable: string): ITtscGraphCommand {
  return /\.(?:cmd|bat)$/i.test(executable)
    ? {
        command: "cmd.exe",
        args: ["/d", "/s", "/c", executable],
      }
    : { command: executable, args: [] };
}

function ttscPackagesBeside(server: string): string[] {
  const directory = path.dirname(server);
  const candidates = [
    path.resolve(directory, "..", "ttsc", "package.json"),
    path.resolve(directory, "node_modules", "ttsc", "package.json"),
  ];
  try {
    const real = fs.realpathSync(server);
    for (let current = path.dirname(real); ; current = path.dirname(current)) {
      candidates.push(path.join(current, "package.json"));
      if (path.dirname(current) === current) break;
    }
  } catch {
    // A command shim need not be a real symlink (Windows npm .cmd files are
    // ordinary files); the deterministic sibling candidates above cover it.
  }
  return candidates;
}
