import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildGraphDump } from "@samchon/graph";

import { BENCHMARK_FIXTURES, findBenchmarkFixture } from "./fixtures.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const benchmarkRoot = path.join(repositoryRoot, "tests", "benchmark");
const workRoot = path.join(benchmarkRoot, ".work");
const resultsRoot = path.join(benchmarkRoot, "results");

const parseArgs = (argv) => {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--") === false) continue;
    const eq = arg.indexOf("=");
    if (eq >= 0) out[arg.slice(2, eq)] = arg.slice(eq + 1);
    else out[arg.slice(2)] = argv[++i] ?? "true";
  }
  return out;
};

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    shell: false,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
};

const ensureDir = (dir) => fs.mkdirSync(dir, { recursive: true });

const cloneFixture = (fixture, refresh) => {
  ensureDir(workRoot);
  const dir = path.join(workRoot, fixture.name);
  if (refresh && fs.existsSync(dir)) fs.rmSync(dir, { force: true, recursive: true });
  if (fs.existsSync(dir) === false) run("git", ["clone", "--depth=1", fixture.repository, dir]);
  return dir;
};

const args = parseArgs(process.argv.slice(2));
const fixtures =
  args.fixture === undefined
    ? BENCHMARK_FIXTURES
    : [findBenchmarkFixture(args.fixture)];
const mode = args.mode ?? "static";
const results = [];

for (const fixture of fixtures) {
  const cwd = cloneFixture(fixture, args.refresh === "true");
  const started = performance.now();
  const dump = await buildGraphDump({
    cwd,
    mode,
    languages: [fixture.language],
    maxFiles: fixture.maxFiles,
  });
  const elapsedMs = Math.round(performance.now() - started);
  results.push({
    fixture: fixture.name,
    repository: fixture.repository,
    language: fixture.language,
    mode,
    indexer: dump.indexer,
    elapsedMs,
    nodeCount: dump.nodes.length,
    edgeCount: dump.edges.length,
    diagnosticCount: dump.diagnostics?.length ?? 0,
    warningCount: dump.warnings?.length ?? 0,
  });
}

ensureDir(resultsRoot);
const out = path.join(resultsRoot, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
fs.writeFileSync(out, `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`);
console.log(JSON.stringify({ out, results }, null, 2));
