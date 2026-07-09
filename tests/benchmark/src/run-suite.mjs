// Orchestrates the Claude Code agent-cost A/B across the corpus: for every
// repo x prompt family it measures the baseline ONCE (cached as its own
// report) and then each requested tool with --arm=graph, so no credits are
// re-spent on identical baselines. Existing reports are skipped, making the
// suite resumable after an interruption. This SPENDS real Claude credits and
// is user-triggered only.
//
// Usage:
//   node tests/benchmark/src/run-suite.mjs --runs=1
//   node tests/benchmark/src/run-suite.mjs --repos=gin,flask --families=dedicated --tools=samchon-graph,serena
import cp from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CORPUS } from "./corpus.mjs";
import { parseArgs } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const agentAb = path.join(here, "agent-ab.mjs");
const resultsRoot = path.resolve(here, "..", "results");

const args = parseArgs(process.argv.slice(2));
const runs = args.runs ?? "1";
const model = args.model ?? "sonnet";
const families = (args.families ?? "common,dedicated").split(",");
const repos = args.repos ? args.repos.split(",") : CORPUS.map((entry) => entry.name);
const tools = (args.tools ?? "samchon-graph,codegraph,serena").split(",");

const failures = [];
const invoke = (repo, family, extra, label) => {
  const reportName = `claude-${repo}-${family}-${label}.json`;
  if (fs.existsSync(path.join(resultsRoot, reportName))) {
    console.log(`\n=== ${repo} / ${family} / ${label}: cached (${reportName}) ===`);
    return;
  }
  console.log(`\n=== ${repo} / ${family} / ${label} ===`);
  const result = cp.spawnSync(
    process.execPath,
    [agentAb, `--repo=${repo}`, `--prompt-family=${family}`, `--runs=${runs}`, `--model=${model}`, ...extra],
    { stdio: "inherit", windowsHide: true },
  );
  if (result.status !== 0) {
    failures.push(`${repo}/${family}/${label} (exit ${result.status})`);
    console.log(`  !! ${repo}/${family}/${label} exited ${result.status}`);
  }
};

for (const family of families) {
  for (const repo of repos) {
    invoke(repo, family, ["--arm=baseline"], "baseline");
    for (const tool of tools) {
      const flag = tool === "codegraph" ? ["--cg=1"] : tool === "serena" ? ["--serena=1"] : [];
      invoke(repo, family, ["--arm=graph", ...flag], tool);
    }
  }
}

console.log(`\n=== suite complete ===`);
if (failures.length > 0) {
  console.log(`FAILED cells (${failures.length}):`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log("all cells measured (or cached)");
}
console.log(`render: node tests/benchmark/src/render-svg.mjs`);
