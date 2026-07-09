// Parallel-within-family variant of run-suite.mjs: runs multiple repos'
// pipelines concurrently, but each repo's own cells (baseline, then every
// tool) always run strictly sequentially inside one lane, since they share
// the same on-disk checkout (clonePinned races otherwise). Families never
// overlap — every common cell finishes before any dedicated cell starts —
// so a partial run never mixes them. Reports are cached by filename, so this
// is safe to run alongside (or resume after) the sequential run-suite.mjs;
// already-written reports are skipped.
//
// Usage:
//   node tests/benchmark/src/run-suite-parallel.mjs --runs=1 --concurrency=3
//   node tests/benchmark/src/run-suite-parallel.mjs --repos=gin,flask --families=dedicated --concurrency=2
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
const concurrency = Number(args.concurrency ?? 3);
const corpusArgs = args.corpus ? [`--corpus=${args.corpus}`] : [];

const failures = [];

function runCell(repo, family, extra, label) {
  return new Promise((resolve) => {
    const reportName = `claude-${repo}-${family}-${label}.json`;
    if (fs.existsSync(path.join(resultsRoot, reportName))) {
      console.log(`=== ${repo} / ${family} / ${label}: cached (${reportName}) ===`);
      resolve();
      return;
    }
    console.log(`\n=== ${repo} / ${family} / ${label}: start ===`);
    const child = cp.spawn(
      process.execPath,
      [
        agentAb,
        `--repo=${repo}`,
        `--prompt-family=${family}`,
        `--runs=${runs}`,
        `--model=${model}`,
        ...corpusArgs,
        ...extra,
      ],
      { stdio: "inherit", windowsHide: true },
    );
    child.on("close", (status) => {
      if (status !== 0) {
        failures.push(`${repo}/${family}/${label} (exit ${status})`);
        console.log(`  !! ${repo}/${family}/${label} exited ${status}`);
      } else {
        console.log(`=== ${repo} / ${family} / ${label}: done ===`);
      }
      resolve();
    });
  });
}

// One repo's cells share a checkout, so they must never run concurrently with
// each other — baseline first, then each tool, in sequence within this lane.
async function runRepoPipeline(repo, family) {
  await runCell(repo, family, ["--arm=baseline"], "baseline");
  for (const tool of tools) {
    const flag = tool === "codegraph" ? ["--cg=1"] : tool === "serena" ? ["--serena=1"] : [];
    await runCell(repo, family, ["--arm=graph", ...flag], tool);
  }
}

async function runPool(items, limit, worker) {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

for (const family of families) {
  console.log(`\n########## family: ${family} (concurrency ${concurrency}) ##########`);
  await runPool(repos, concurrency, (repo) => runRepoPipeline(repo, family));
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
