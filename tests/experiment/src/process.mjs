import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const experimentRoot = path.join(repositoryRoot, "tests", "experiment");
export const workRoot = path.join(experimentRoot, ".work");
export const resultsRoot = path.join(experimentRoot, "results");

export const parseArgs = (argv) => {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    // `pnpm run <script> -- --flag value` forwards the bare `--` separator to
    // the script; skip it so it is not mistaken for a flag that swallows the
    // next token.
    if (arg === "--") continue;
    if (arg.startsWith("--") === false) continue;
    const eq = arg.indexOf("=");
    if (eq >= 0) out[arg.slice(2, eq)] = arg.slice(eq + 1);
    else out[arg.slice(2)] = argv[++i] ?? "true";
  }
  return out;
};

export const run = (command, args = [], options = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: { ...process.env, ...(options.env ?? {}) },
    shell: options.shell ?? false,
    stdio: options.stdio ?? "inherit",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
  return result;
};

export const shell = (command, options = {}) =>
  run(command, [], { ...options, shell: true });

export const ensureDir = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
};

export const appendGithubPath = (dir) => {
  process.env.PATH = `${dir}${path.delimiter}${process.env.PATH ?? ""}`;
  if (process.env.GITHUB_PATH !== undefined) {
    fs.appendFileSync(process.env.GITHUB_PATH, `${dir}${os.EOL}`);
  }
};

export const localBin = (name) => {
  const suffix = process.platform === "win32" ? ".cmd" : "";
  const candidates = [
    path.join(experimentRoot, "node_modules", ".bin", `${name}${suffix}`),
    path.join(repositoryRoot, "node_modules", ".bin", `${name}${suffix}`),
  ];
  const found = candidates.find((file) => fs.existsSync(file));
  if (found === undefined) throw new Error(`Unable to find local bin: ${name}`);
  return found;
};

export const cloneRepository = (experiment, options = {}) => {
  ensureDir(workRoot);
  const dir = path.join(workRoot, experiment.language);
  if (options.refresh === true && fs.existsSync(dir)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
  if (fs.existsSync(dir) === false) {
    const args = ["clone", "--depth=1"];
    if (experiment.ref !== undefined) args.push("--branch", experiment.ref);
    args.push(experiment.repository, dir);
    run("git", args);
  }
  return dir;
};
