// Agent-cost A/B for @samchon/graph — a port of codegraph's agent-cost benchmark
// (and @ttsc/graph's faithful port of it), generalized across languages. For one
// question per repo it runs the Claude Code CLI headless twice, once with the
// @samchon/graph MCP server and once with an empty MCP config, both under
// --strict-mcp-config, and reports codegraph's metrics: tokens summed per
// assistant turn, tool-call count, cost, and wall time, median over N runs.
//
// Two prompt families: `common` (the shared onboarding question in
// questions/common.md, asked against every repo, to test whether orientation
// cost stays flat) and `dedicated` (each repo's codegraph question in
// src/corpus.mjs). The prompt is tool-neutral — no graph-specific guidance is
// appended; the tool guidance lives only in the MCP server's tool descriptions
// so both arms pose the identical question and the token comparison stays honest.
//
// This SPENDS real Claude credits, is non-deterministic, and is NOT wired into
// CI. It requires `claude` on PATH and a built @samchon/graph
// (`pnpm --filter @samchon/graph build`). The MCP server is the package's own
// launcher (`packages/graph/lib/bin.js --cwd <repo>`), which builds one resident
// graph and serves `inspect_code_graph` over stdio.
//
// Usage:
//   node tests/benchmark/src/agent-ab.mjs --repo=gin --prompt-family=dedicated --runs=4
//   node tests/benchmark/src/agent-ab.mjs --repo=flask --prompt-family=common --runs=4 --model=opus
//   node tests/benchmark/src/agent-ab.mjs --repo=tokio --serena=1 --runs=2   # comparator arm
import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CORPUS, findCorpus } from "./corpus.mjs";
import {
  benchmarkDir,
  clonePinned,
  ensureInstalled,
  graphLauncher,
  parseArgs as parseArgsShared,
  preflightGraph,
  resolvePrompt,
} from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
void here;

const args = parseArgsShared(process.argv.slice(2));
const repoKey = args.repo ?? CORPUS[0].name;
const spec = findCorpus(repoKey);
const runs = Number(args.runs ?? 2);
const model = args.model ?? "sonnet";
const effort = args.effort ?? "high";
const promptFamily = args["prompt-family"] ?? "dedicated";
if (promptFamily !== "common" && promptFamily !== "dedicated") {
  throw new Error("--prompt-family must be 'common' or 'dedicated'");
}
const prompt = resolvePrompt({
  promptId: args["prompt-id"],
  family: promptFamily,
  repo: repoKey,
});
const question = prompt.text;

const claudeRunTimeoutMs = Number(args["claude-run-timeout-ms"] ?? 900000);
const claudeStartupGraceMs = Number(args["claude-startup-grace-ms"] ?? 5000);
const serena = args.serena === "1" || args.serena === "true";
const serenaCommand = args["serena-command"] ?? "uvx";
const cg = args.cg === "1" || args.cg === "true";
if (cg && serena) throw new Error("--cg and --serena cannot be combined");
const toolName = cg ? "codegraph" : serena ? "serena" : "samchon-graph";

const corpusRoot = args.corpus ?? path.join(os.tmpdir(), "samchon-graph-corpus");
const repoDir = args["repo-dir"]
  ? path.resolve(args["repo-dir"])
  : path.join(corpusRoot, repoKey);

const armFilter = args.arm ?? "both";
const armsRequested = {
  baseline: armFilter === "both" || armFilter === "baseline",
  graph: armFilter === "both" || armFilter === "graph",
};
if (!armsRequested.baseline && !armsRequested.graph) {
  throw new Error(`--arm must be baseline | graph | both, got ${armFilter}`);
}

// 1. A built launcher is required for the graph arm.
if (armsRequested.graph && !serena && !cg && !fs.existsSync(graphLauncher)) {
  throw new Error(
    `@samchon/graph launcher not built: ${graphLauncher}\n` +
      "Run `pnpm --filter @samchon/graph build` first.",
  );
}

// 2. Pinned checkout + dependencies, then the graph-arm preflight gate: a host
// missing the language server would silently measure the static fallback.
if (args["repo-dir"] && !fs.existsSync(repoDir)) {
  throw new Error(`--repo-dir does not exist: ${repoDir}`);
}
if (!args["repo-dir"]) {
  fs.mkdirSync(corpusRoot, { recursive: true });
  clonePinned(spec, corpusRoot);
}
ensureInstalled(repoDir, { noInstall: args["no-install"] === "1" });
if (armsRequested.graph && !serena && !cg) {
  const flight = preflightGraph(spec, repoDir);
  if (!flight.ok && args["allow-static"] !== "1") {
    throw new Error(
      `preflight: ${repoKey} (${spec.language}) produced indexer="${flight.indexer}" — install ` +
        `the language server or pass --allow-static=1.\nwarnings: ${flight.warnings.join("; ")}`,
    );
  }
}

// 2b. codegraph setup cost, mirroring the codex harness: `codegraph init` runs
// once, outside the measured cell, and its wall time is recorded as toolSetupMs.
let toolSetupMs;
if (armsRequested.graph && cg) {
  const started = Date.now();
  console.log(`codegraph init ${repoDir} ...`);
  runOrThrow("codegraph", ["init", repoDir], repoDir);
  toolSetupMs = Date.now() - started;
  console.log(`codegraph indexed in ${(toolSetupMs / 1000).toFixed(0)}s`);
}

// 3. WITH = @samchon/graph (or a comparator); WITHOUT = empty config. Both under
// --strict-mcp-config so the only difference is the graph server.
const graphMaxFiles = args["max-files"] ?? spec.maxFiles;
const withCfg = armsRequested.graph
  ? path.join(os.tmpdir(), `mcp-samchon-graph-${process.pid}.json`)
  : null;
const emptyCfg = armsRequested.baseline
  ? path.join(os.tmpdir(), `mcp-empty-${process.pid}.json`)
  : null;
if (withCfg) {
  const serverCfg = serena
    ? { serena: serenaServerConfig(repoDir) }
    : cg
      ? { codegraph: codegraphServerConfig(repoDir) }
      : {
          "samchon-graph": {
            command: process.execPath,
            args: [
              graphLauncher,
              "--cwd",
              repoDir,
              ...(graphMaxFiles ? ["--max-files", String(graphMaxFiles)] : []),
              ...(spec.lspTimeoutMs ? ["--lsp-timeout-ms", String(spec.lspTimeoutMs)] : []),
            ],
          },
        };
  fs.writeFileSync(withCfg, JSON.stringify({ mcpServers: serverCfg }));
}
if (emptyCfg) fs.writeFileSync(emptyCfg, JSON.stringify({ mcpServers: {} }));
const arms = [
  { name: "baseline", cfg: emptyCfg },
  { name: "graph", cfg: withCfg },
].filter((a) => a.cfg);

console.log(
  `\nagent-cost A/B on ${repoKey} (${spec.language}) via claude — model ${model}, ` +
    `${runs} run(s) x ${arms.length} arm(s), prompt ${promptFamily}, tool ${toolName}`,
);
console.log(`Q: ${question}\n`);

// A baseline-only run is tool-independent; name it so every tool's comparison
// can join against the same cached baseline instead of re-spending on it.
const reportTool = armsRequested.graph ? toolName : "baseline";
const reportPath = args.report
  ? path.resolve(args.report)
  : path.join(benchmarkDir, "results", `claude-${repoKey}-${promptFamily}-${reportTool}.json`);
const traceDir = path.join(
  path.dirname(reportPath),
  `${path.basename(reportPath, path.extname(reportPath))}.traces`,
);
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.rmSync(reportPath, { force: true });
fs.rmSync(traceDir, { recursive: true, force: true });
fs.mkdirSync(traceDir, { recursive: true });

const samples = Object.fromEntries(arms.map((a) => [a.name, []]));
let spent = 0;
const MAX_RUN_RETRIES = Number(args["max-run-retries"] ?? 4);
const concurrency = Number(process.env.SAMCHON_BENCH_CONCURRENCY) || 2;
const thunks = arms.flatMap((arm) =>
  Array.from({ length: runs }, (_, r) => async () => {
    let m;
    let attempts = 0;
    for (let attempt = 0; attempt <= MAX_RUN_RETRIES; attempt++) {
      attempts = attempt + 1;
      m = await runClaude(question, arm.cfg, arm.name, r + 1);
      // A 529-overload reports subtype "success" with is_error and zero tokens,
      // so only a zero-token run is invalid and worth retrying.
      if (Number(m?.tokens ?? 0) > 0) break;
      if (attempt < MAX_RUN_RETRIES) {
        console.log(
          `  ${arm.name.padEnd(8)} run ${r + 1}: [retry ${attempt + 1}/${MAX_RUN_RETRIES}] ${m.error || ""}`,
        );
      }
    }
    m.promptId = prompt.entry.id;
    m.questionSha256 = prompt.entry.questionSha256;
    m.run = r + 1;
    m.attempts = attempts;
    samples[arm.name].push(m);
    spent += m.cost;
    console.log(
      `  ${arm.name.padEnd(8)} run ${r + 1}: $${m.cost.toFixed(3)}, ${m.tokens} tok, ${m.tools} tools ` +
        `(read ${m.reads}, grep ${m.grep}, shell ${m.shell}, graph ${m.graph}), ${(m.durMs / 1000).toFixed(0)}s` +
        (m.ok ? "" : `  [FAILED${m.error ? `: ${m.error}` : ""}]`) +
        `  [running $${spent.toFixed(2)}]`,
    );
  }),
);
await runWithConcurrency(thunks, concurrency);

const med = (arm, k) =>
  median(
    (samples[arm] ?? [])
      .filter((m) => Number(m?.tokens ?? 0) > 0)
      .map((m) => m[k]),
  );
const pct = (g, b) => (b === 0 ? 0 : Math.round((1 - g / b) * 100));

console.log(`\nMedian of ${runs} run(s), claude-code metrics:`);
const line = (label, k, fmt = (x) => x) => {
  const b = med("baseline", k);
  const g = med("graph", k);
  if (armsRequested.baseline && armsRequested.graph) {
    console.log(`  ${label.padEnd(12)} baseline ${fmt(b)}  ->  graph ${fmt(g)} (${pct(g, b)}%)`);
  } else if (armsRequested.baseline) {
    console.log(`  ${label.padEnd(12)} baseline ${fmt(b)}`);
  } else {
    console.log(`  ${label.padEnd(12)} graph ${fmt(g)}`);
  }
};
line("tokens", "tokens");
line("tool calls", "tools");
line("cost", "cost", (x) => `$${x.toFixed(3)}`);
line("wall time", "durMs", (x) => `${(x / 1000).toFixed(0)}s`);
console.log(`\nTotal spend this run: $${spent.toFixed(2)}`);

fs.writeFileSync(
  reportPath,
  `${JSON.stringify(
    {
      harness: "claude-code",
      tool: reportTool,
      ...(toolSetupMs !== undefined ? { toolSetupMs } : {}),
      repo: repoKey,
      language: spec.language,
      commit: spec.commit,
      repoDir,
      model,
      effort,
      promptId: prompt.entry.id,
      promptFamily,
      questionSha256: prompt.entry.questionSha256,
      runs,
      question,
      traceDir,
      samples,
    },
    null,
    2,
  )}\n`,
);
console.log(`\nReport: ${reportPath}`);
if (withCfg) fs.rmSync(withCfg, { force: true });
if (emptyCfg) fs.rmSync(emptyCfg, { force: true });

async function runWithConcurrency(work, limit) {
  let next = 0;
  const worker = async () => {
    while (next < work.length) await work[next++]();
  };
  const lanes = Math.max(1, Math.min(limit, work.length));
  await Promise.all(Array.from({ length: lanes }, worker));
}

async function runClaude(prompt, cfg, armName, runNumber) {
  const delayedInput = armName === "graph" && claudeStartupGraceMs > 0;
  const claudeArgs = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    ...(delayedInput ? ["--input-format", "stream-json"] : []),
    "--no-session-persistence",
    "--permission-mode",
    "bypassPermissions",
    "--disallowedTools",
    "Agent",
    "--model",
    model,
    "--effort",
    effort,
    "--max-budget-usd",
    "4",
    "--strict-mcp-config",
    "--mcp-config",
    cfg,
  ];
  const base = `${armName}-run-${runNumber}`;
  const claudeHome = prepareClaudeHome(path.join(traceDir, `${base}.home`));
  const result = await spawnAsync("claude", claudeArgs, {
    cwd: repoDir,
    env: { ...process.env, HOME: claudeHome, USERPROFILE: claudeHome },
    input: delayedInput ? streamJsonUserInput(prompt) : prompt,
    inputDelayMs: delayedInput ? claudeStartupGraceMs : 0,
    windowsHide: true,
    shell: true,
    timeout: claudeRunTimeoutMs,
  });
  const stdout = result.stdout ?? "";
  fs.writeFileSync(path.join(traceDir, `${base}.stream.jsonl`), stdout);
  if (result.stderr) fs.writeFileSync(path.join(traceDir, `${base}.stderr.log`), result.stderr);
  if (result.error) return { tokens: 0, tools: 0, reads: 0, grep: 0, shell: 0, web: 0, graph: 0, cost: 0, durMs: 0, ok: false, answer: "", error: String(result.error.message).slice(0, 80) };
  return parseStream(stdout);
}

function streamJsonUserInput(text) {
  return `${JSON.stringify({ type: "user", message: { role: "user", content: text }, session_id: "benchmark", parent_tool_use_id: null })}\n`;
}

function prepareClaudeHome(targetHome) {
  fs.rmSync(targetHome, { recursive: true, force: true });
  fs.mkdirSync(path.join(targetHome, ".claude"), { recursive: true });
  copyIfExists(path.join(os.homedir(), ".claude.json"), targetHome);
  copyIfExists(path.join(os.homedir(), ".claude", ".credentials.json"), path.join(targetHome, ".claude"));
  return targetHome;
}

function copyIfExists(source, targetDir) {
  if (!fs.existsSync(source)) return;
  fs.copyFileSync(source, path.join(targetDir, path.basename(source)));
}

function spawnAsync(command, commandArgs, { input, inputDelayMs = 0, ...spawnOpts }) {
  return new Promise((resolve) => {
    const child = cp.spawn(command, commandArgs, spawnOpts);
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));
    child.on("error", (error) => resolve({ error, stdout, stderr }));
    child.on("close", () => resolve({ stdout, stderr }));
    if (input) {
      const writeInput = () => {
        if (!child.stdin || child.stdin.destroyed || !child.stdin.writable) return;
        child.stdin.write(input);
        child.stdin.end();
      };
      if (inputDelayMs > 0) setTimeout(writeInput, inputDelayMs);
      else writeInput();
    } else {
      child.stdin?.end();
    }
  });
}

function codegraphServerConfig(targetRepoDir) {
  const command = process.platform === "win32" ? "cmd.exe" : "codegraph";
  const cgArgs = (process.platform === "win32" ? ["/d", "/s", "/c", "codegraph"] : []).concat([
    "serve",
    "--mcp",
    "--path",
    targetRepoDir,
  ]);
  return { command, args: cgArgs, env: { CODEGRAPH_NO_DAEMON: "1" } };
}

function serenaServerConfig(targetRepoDir) {
  return {
    command: serenaCommand,
    args: [
      "--from",
      "git+https://github.com/oraios/serena",
      "serena",
      "start-mcp-server",
      "--context",
      "claude-code",
      "--project",
      targetRepoDir,
      "--enable-web-dashboard",
      "False",
      "--log-level",
      "WARNING",
    ],
  };
}

// parseStream mirrors codegraph's parser: tokens summed over every assistant
// turn's usage (not the last-turn result.usage), tool calls counted across
// assistant events (ToolSearch excluded).
function parseStream(text) {
  let tokens = 0, tools = 0, reads = 0, grep = 0, shell = 0, web = 0, graph = 0, other = 0;
  let modelVersion = null, result = null, lastAssistantText = "";
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    let e;
    try {
      e = JSON.parse(raw);
    } catch {
      continue;
    }
    if (typeof e.model === "string") modelVersion ??= e.model;
    if (e.type === "assistant") {
      if (typeof e.message?.model === "string") modelVersion ??= e.message.model;
      const u = e.message?.usage;
      if (u) {
        tokens += (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      }
      const textBlocks = [];
      for (const b of e.message?.content || []) {
        if (b.type === "text" && typeof b.text === "string") {
          textBlocks.push(b.text);
          continue;
        }
        if (b.type !== "tool_use") continue;
        if (b.name === "ToolSearch") continue;
        tools++;
        const input = b.input || {};
        if (b.name === "Read") reads++;
        else if (b.name === "Grep" || b.name === "Glob") grep++;
        else if (b.name === "Bash" || b.name === "PowerShell" || b.name === "Shell") shell++;
        else if (/graph|inspect_code|samchon|serena|find_symbol|references|symbols_overview/i.test(b.name)) graph++;
        else if (/web/i.test(b.name)) web++;
        else other++;
        void input;
      }
      if (textBlocks.length) lastAssistantText = textBlocks.join("\n");
    } else if (e.type === "result") {
      result = e;
    }
  }
  const ok = result?.subtype === "success" && !result?.is_error;
  const answer = ok && typeof result?.result === "string" && result.result.trim() ? result.result : lastAssistantText;
  return {
    tokens,
    tools,
    reads,
    grep,
    shell,
    web,
    graph,
    other,
    cost: result?.total_cost_usd || 0,
    durMs: result?.duration_ms || 0,
    ...(modelVersion ? { modelVersion } : {}),
    ok,
    answer,
    error: result?.is_error ? String(result?.result || "").slice(0, 80) : "",
  };
}

function runOrThrow(command, commandArgs, cwd) {
  const result = cp.spawnSync(command, commandArgs, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    shell: true,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${commandArgs.join(" ")} failed (${result.status})`);
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) out[match[1]] = match[2];
    else if (arg.startsWith("--")) out[arg.slice(2)] = "true";
  }
  return out;
}
