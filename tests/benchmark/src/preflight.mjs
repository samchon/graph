// Zero-spend go/no-go check for the codex benchmark: verifies every
// prerequisite the paid run depends on, then walks the corpus and builds a
// bounded @samchon/graph dump per repo to prove the language server actually
// answers on this host. Nothing here talks to a model.
//
//   node tests/benchmark/src/preflight.mjs
//   node tests/benchmark/src/preflight.mjs --repos=gin,flask --skip-tools=1
import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CORPUS } from "./corpus.mjs";
import {
  benchmarkDir,
  clonePinned,
  ensureInstalled,
  graphLauncher,
  parseArgs,
  preflightGraph,
  resolvePrompt,
  runPrepare,
} from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const repos = args.repos ? args.repos.split(",") : CORPUS.map((entry) => entry.name);
const corpusRoot = args.corpus ?? path.join(os.tmpdir(), "samchon-graph-corpus");
fs.mkdirSync(corpusRoot, { recursive: true });

const probe = (command, probeArgs) => {
  const result = cp.spawnSync(command, probeArgs, { encoding: "utf8", windowsHide: true, shell: true });
  return result.status === 0 ? (result.stdout || result.stderr || "").trim().split("\n")[0] : undefined;
};

let fatal = 0;
console.log("=== tooling ===");
if (args["skip-tools"] !== "1") {
  const codex = probe("codex", ["--version"]);
  console.log(`  codex:      ${codex ?? "MISSING"}`);
  const auth = fs.existsSync(path.join(os.homedir(), ".codex", "auth.json"));
  console.log(`  codex auth: ${auth ? "ok (~/.codex/auth.json)" : "MISSING — run codex login"}`);
  const cg = probe("codegraph", ["--version"]) ?? probe("codegraph", ["--help"]);
  console.log(`  codegraph:  ${cg ?? "MISSING"}`);
  const uvx = probe("uvx", ["--version"]);
  console.log(`  uvx:        ${uvx ?? "MISSING (serena arm unavailable)"}`);
  if (!codex || !auth) fatal++;
}
if (!fs.existsSync(graphLauncher)) {
  console.log(`  launcher:   MISSING (${graphLauncher}) — run pnpm --filter @samchon/graph build`);
  fatal++;
} else {
  console.log(`  launcher:   ok`);
}

console.log("\n=== prompts (SHA-256 gate) ===");
resolvePrompt({ family: "common" });
for (const entry of CORPUS) resolvePrompt({ family: "dedicated", repo: entry.name });
console.log(`  ${CORPUS.length + 1} prompts verified against the manifest`);

console.log("\n=== corpus graph preflight (bounded dump per repo) ===");
const rows = [];
for (const name of repos) {
  const spec = CORPUS.find((entry) => entry.name === name);
  if (!spec) throw new Error(`unknown repo ${name}`);
  let row;
  try {
    const repoDir = clonePinned(spec, corpusRoot);
    ensureInstalled(repoDir);
    runPrepare(spec, repoDir);
    const flight = preflightGraph(spec, repoDir);
    row = { name, language: spec.language, ...flight };
  } catch (error) {
    row = { name, language: spec.language, indexer: "error", nodes: 0, edges: 0, ok: false, warnings: [String(error.message).split("\n")[0]] };
  }
  rows.push(row);
  console.log(
    `  ${row.name.padEnd(12)} ${row.language.padEnd(11)} ${row.ok ? "GO  " : "NO-GO"} ` +
      `indexer=${row.indexer} nodes=${row.nodes} edges=${row.edges}` +
      (row.warnings.length > 0 ? ` | ${row.warnings[0]}` : ""),
  );
}

const go = rows.filter((row) => row.ok).length;
console.log(`\n${go}/${rows.length} repos GO for the @samchon/graph arm${fatal > 0 ? ` — ${fatal} FATAL tooling gap(s)` : ""}`);
const resultsRoot = path.join(benchmarkDir, "results");
fs.mkdirSync(resultsRoot, { recursive: true });
fs.writeFileSync(
  path.join(resultsRoot, "preflight.json"),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2)}\n`,
);
if (fatal > 0) process.exitCode = 1;
