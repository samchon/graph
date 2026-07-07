// Orchestrates the agent-cost A/B (agent-ab.mjs) across the whole cross-language
// corpus, once per prompt family, and prints a compact per-repo summary. This
// SPENDS real Claude credits for every repo x family x arm x run, so it is
// user-triggered only.
//
// Usage:
//   node tests/benchmark/src/run-suite.mjs --runs=4 --model=sonnet
//   node tests/benchmark/src/run-suite.mjs --prompt-family=common --runs=2
//   node tests/benchmark/src/run-suite.mjs --repos=gin,flask,express --runs=4
import cp from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CORPUS } from "./corpus.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const agentAb = path.join(here, "agent-ab.mjs");
const resultsRoot = path.resolve(here, "..", "results");

const args = parseArgs(process.argv.slice(2));
const runs = args.runs ?? "4";
const model = args.model ?? "sonnet";
const families = args["prompt-family"] ? [args["prompt-family"]] : ["common", "dedicated"];
const repos = args.repos ? args.repos.split(",") : CORPUS.map((entry) => entry.name);

for (const family of families) {
  for (const repo of repos) {
    console.log(`\n=== ${repo} / ${family} ===`);
    const result = cp.spawnSync(
      process.execPath,
      [agentAb, `--repo=${repo}`, `--prompt-family=${family}`, `--runs=${runs}`, `--model=${model}`],
      { stdio: "inherit", windowsHide: true },
    );
    if (result.status !== 0) console.log(`  (${repo}/${family} exited ${result.status})`);
  }
}

// Summarize whatever reports landed in results/.
console.log("\n=== suite summary (median tokens, baseline -> graph) ===");
for (const family of families) {
  for (const repo of repos) {
    const reportPath = path.join(resultsRoot, `agent-ab-${repo}-${family}.json`);
    if (!fs.existsSync(reportPath)) continue;
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    const med = (arm) => {
      const values = (report.samples[arm] ?? []).filter((m) => m.tokens > 0).map((m) => m.tokens).sort((a, b) => a - b);
      if (values.length === 0) return 0;
      const mid = Math.floor(values.length / 2);
      return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
    };
    const b = med("baseline");
    const g = med("graph");
    const pct = b === 0 ? 0 : Math.round((1 - g / b) * 100);
    console.log(`  ${repo.padEnd(12)} ${family.padEnd(10)} ${String(b).padStart(8)} -> ${String(g).padStart(8)} (${pct}%)`);
  }
}

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) out[match[1]] = match[2];
  }
  return out;
}
