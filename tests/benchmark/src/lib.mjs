// Shared plumbing for the benchmark harnesses (agent-ab.mjs, agent-ab-codex.mjs,
// preflight.mjs): manifest-pinned prompt resolution, commit-pinned checkouts,
// dependency installation, and the graph-arm preflight gate.
import crypto from "node:crypto";
import cp from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const benchmarkDir = path.resolve(here, "..");
export const repoRoot = path.resolve(benchmarkDir, "..", "..");
export const graphLauncher = path.join(repoRoot, "packages", "graph", "lib", "bin.js");
export const questionsDir = path.join(benchmarkDir, "questions");

// Language servers provisioned for the benchmark live under .work/tools/<name>
// (gitignored). Prepend each tool's bin (or root) to PATH so every child this
// process spawns — the preflight dump, codex, and the MCP servers codex spawns
// in turn — can resolve them without machine-global installs.
const toolsRoot = path.join(benchmarkDir, ".work", "tools");
if (fs.existsSync(toolsRoot)) {
  const extra = fs
    .readdirSync(toolsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const bin = path.join(toolsRoot, entry.name, "bin");
      return fs.existsSync(bin) ? bin : path.join(toolsRoot, entry.name);
    });
  if (extra.length > 0) {
    process.env.PATH = `${extra.join(path.delimiter)}${path.delimiter}${process.env.PATH ?? ""}`;
  }
}

export function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

// Resolve a benchmark prompt from questions/manifest.json by id or family
// (+repo), read the pinned .md, and REFUSE to run when the file no longer
// matches its pinned hash — a run must be able to prove which utterance it
// measured.
export function resolvePrompt({ promptId, family, repo }) {
  const manifest = JSON.parse(fs.readFileSync(path.join(questionsDir, "manifest.json"), "utf8"));
  const prompts = manifest.prompts ?? [];
  const entry = promptId
    ? prompts.find((p) => p.id === promptId)
    : prompts.find((p) => p.family === family && (p.family === "common" || p.repo === repo));
  if (!entry) {
    throw new Error(
      promptId
        ? `unknown prompt id ${promptId}; manifest has ${prompts.map((p) => p.id).join(", ")}`
        : `no manifest prompt for family ${family}${repo ? ` repo ${repo}` : ""}`,
    );
  }
  // Normalize CRLF so git's line-ending conversion on a different host can
  // never flip the hash or the prompt bytes.
  const text = fs
    .readFileSync(path.join(questionsDir, entry.file), "utf8")
    .replace(/\r\n/g, "\n")
    .trim();
  const actual = sha256(text);
  if (actual !== entry.questionSha256) {
    throw new Error(
      `${entry.file} does not match its pinned SHA-256 (manifest ${entry.questionSha256}, actual ${actual}); ` +
        "regenerate with generate-manifest.mjs or restore the file",
    );
  }
  return { entry, text };
}

// Clone the corpus entry at its PINNED commit. Upstream default branches move;
// the measurement must not.
export function clonePinned(spec, corpusRoot) {
  const repoDir = path.join(corpusRoot, spec.name);
  const ok = () =>
    fs.existsSync(path.join(repoDir, ".git")) &&
    run("git", ["rev-parse", "HEAD"], { cwd: repoDir }).trim() === spec.commit;
  if (fs.existsSync(repoDir)) {
    if (ok()) return repoDir;
    throw new Error(`${repoDir} exists but is not at pinned commit ${spec.commit}; remove it and retry`);
  }
  fs.mkdirSync(repoDir, { recursive: true });
  console.log(`Fetching ${spec.url}@${spec.commit.slice(0, 12)} -> ${repoDir} ...`);
  run("git", ["init", "--quiet"], { cwd: repoDir });
  run("git", ["remote", "add", "origin", spec.url], { cwd: repoDir });
  run("git", ["fetch", "--quiet", "--depth", "1", "origin", spec.commit], { cwd: repoDir });
  run("git", ["checkout", "--quiet", spec.commit], { cwd: repoDir });
  if (!ok()) throw new Error(`pinned checkout of ${spec.name} failed`);
  return repoDir;
}

// Install JS/TS dependencies from the lockfile so tsserver resolves imports at
// full strength. Other ecosystems' servers fetch their own dependencies (gopls,
// rust-analyzer) or work from source; anything extra goes through `prepare`.
export function ensureInstalled(repoDir, { noInstall = false } = {}) {
  if (noInstall) return;
  if (!fs.existsSync(path.join(repoDir, "package.json"))) return;
  if (fs.existsSync(path.join(repoDir, "node_modules"))) return;
  const plan = fs.existsSync(path.join(repoDir, "pnpm-lock.yaml"))
    ? { label: "pnpm", command: "pnpm", args: ["install", "--frozen-lockfile", "--ignore-scripts"] }
    : fs.existsSync(path.join(repoDir, "package-lock.json"))
      ? { label: "npm", command: "npm", args: ["ci", "--ignore-scripts"] }
      : fs.existsSync(path.join(repoDir, "yarn.lock"))
        ? { label: "yarn", command: "corepack", args: ["yarn", "install", "--frozen-lockfile", "--ignore-scripts"] }
        : { label: "npm", command: "npm", args: ["install", "--ignore-scripts"] };
  console.log(`Installing dependencies in ${repoDir} (${plan.label})...`);
  run(plan.command, plan.args, { cwd: repoDir, shell: true, stdio: "inherit" });
}

// The graph-arm gate: build a bounded dump of the pinned checkout and demand a
// real language-server graph. Without this, a host missing the language server
// would silently measure the static fallback and corrupt the comparison.
export function preflightGraph(spec, repoDir, { maxFiles = 25 } = {}) {
  const out = run(process.execPath, [
    graphLauncher,
    "dump",
    "--cwd",
    repoDir,
    "--language",
    spec.language,
    "--mode",
    "lsp",
    "--max-files",
    String(maxFiles),
  ]);
  const dump = JSON.parse(out);
  return {
    indexer: dump.indexer,
    nodes: dump.nodes.length,
    edges: dump.edges.length,
    warnings: dump.warnings ?? [],
    ok: dump.indexer !== "static" && dump.nodes.length > 0,
  };
}

export function run(command, args, options = {}) {
  const result = cp.spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status})\n${(result.stderr ?? "").slice(0, 2000)}`,
    );
  }
  return result.stdout ?? "";
}

export function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) out[match[1]] = match[2];
    else if (arg.startsWith("--")) out[arg.slice(2)] = "true";
  }
  return out;
}

export function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
