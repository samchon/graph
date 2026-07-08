// Agent-cost A/B for @samchon/graph driven by OpenAI's `codex` CLI — a faithful
// port of @ttsc/graph's agent-ab-codex.mjs (itself a port of codegraph's
// headline benchmark), generalized across languages. One manifest-pinned
// question per repo, one run per arm: baseline (no MCP) vs a graph tool
// (@samchon/graph by default; codegraph with --cg=1; serena with --serena=1),
// reporting tokens summed per turn, tool calls, and wall time, median over N.
//
// codex is configured through a MINIMAL temp CODEX_HOME per arm (a copied
// auth.json plus a generated config.toml) so the user's real AGENTS.md/hooks do
// not leak into the measurement and the only difference between arms is the MCP
// server. Model defaults to gpt-5.4-mini, reasoning effort pinned high.
// codex --json has no cost field, so tokens + tools + wall time are the metrics.
//
// Rigor gates:
// - prompts resolve through questions/manifest.json and refuse to run on a
//   SHA-256 mismatch; promptId + questionSha256 are recorded on every sample;
// - checkouts are pinned to the corpus commit, never a moving branch;
// - the @samchon/graph arm preflights a bounded dump and ABORTS if the language
//   server is missing (a silent static fallback would corrupt the comparison);
// - the codegraph arm runs `codegraph init` first and records its wall time as
//   toolSetupMs, mirroring how ttsc reported setup cost.
//
// Spends real codex credits; non-deterministic; NOT wired into CI.
//
// Usage:
//   node tests/benchmark/src/agent-ab-codex.mjs --repo=gin --prompt-family=dedicated --runs=1
//   node tests/benchmark/src/agent-ab-codex.mjs --repo=gin --prompt-family=dedicated --cg=1 --runs=1
//   node tests/benchmark/src/agent-ab-codex.mjs --repo=gin --prompt-family=common --serena=1 --runs=1
import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CORPUS, findCorpus } from "./corpus.mjs";
import {
  benchmarkDir,
  clonePinned,
  ensureInstalled,
  graphLauncher,
  median,
  parseArgs,
  preflightGraph,
  resolvePrompt,
} from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const repoKey = args.repo ?? CORPUS[0].name;
const spec = findCorpus(repoKey);
const runs = Number(args.runs ?? 1);
const model = args.model ?? "gpt-5.4-mini";
const effort = args.effort ?? "high";
const family = args["prompt-family"] ?? "dedicated";
const prompt = resolvePrompt({
  promptId: args["prompt-id"],
  family,
  repo: repoKey,
});
const question = prompt.text;

const cg = args.cg === "1" || args.cg === "true";
const serena = args.serena === "1" || args.serena === "true";
if (cg && serena) throw new Error("--cg and --serena cannot be combined");
const toolName = cg ? "codegraph" : serena ? "serena" : "samchon-graph";
const serenaCommand = args["serena-command"] ?? "uvx";
const codexRunTimeoutMs = Number(args["codex-run-timeout-ms"] ?? 1_200_000);

const armFilter = args.arm ?? "both";
const armsRequested = {
  baseline: armFilter === "both" || armFilter === "baseline",
  graph: armFilter === "both" || armFilter === "graph",
};
if (!armsRequested.baseline && !armsRequested.graph) {
  throw new Error(`--arm must be baseline | graph | both, got ${armFilter}`);
}

// 1. Pinned checkout + dependencies.
const corpusRoot = args.corpus ?? path.join(os.tmpdir(), "samchon-graph-corpus");
fs.mkdirSync(corpusRoot, { recursive: true });
const repoDir = args["repo-dir"] ? path.resolve(args["repo-dir"]) : clonePinned(spec, corpusRoot);
const graphFile = path.join(corpusRoot, `${repoKey}.graph.json`);
ensureInstalled(repoDir, { noInstall: args["no-install"] === "1" });

// 2. Graph-arm prerequisites, verified BEFORE any credits are spent.
let toolSetupMs;
if (armsRequested.graph) {
  if (!cg && !serena) {
    if (!fs.existsSync(graphLauncher)) {
      throw new Error(`@samchon/graph launcher not built: ${graphLauncher}\nRun \`pnpm --filter @samchon/graph build\` first.`);
    }
    // Pre-build the full-density dump once, outside the measured cell, and
    // serve it via --graph-file — the same treatment codegraph gets from its
    // `init` (both recorded as toolSetupMs). This is also the preflight: a
    // static dump aborts the run instead of corrupting the comparison.
    const started = Date.now();
    const fd = fs.openSync(graphFile, "w");
    const built = cp.spawnSync(
      process.execPath,
      [
        graphLauncher,
        "dump",
        "--cwd",
        repoDir,
        "--mode",
        "lsp",
        "--max-files",
        String(spec.maxFiles),
        "--lsp-reference-limit",
        String(args["reference-limit"] ?? 2000),
        ...(spec.lspTimeoutMs ? ["--lsp-timeout-ms", String(spec.lspTimeoutMs)] : []),
        ...(spec.lspWarmupTimeoutMs
          ? ["--lsp-warmup-timeout-ms", String(spec.lspWarmupTimeoutMs)]
          : []),
      ],
      { stdio: ["ignore", fd, "pipe"], encoding: "utf8", windowsHide: true },
    );
    fs.closeSync(fd);
    if (built.status !== 0) {
      throw new Error(`graph pre-build failed (${built.status})\n${(built.stderr ?? "").slice(0, 1000)}`);
    }
    toolSetupMs = Date.now() - started;
    const dump = JSON.parse(fs.readFileSync(graphFile, "utf8"));
    if (dump.indexer === "static" && args["allow-static"] !== "1") {
      throw new Error(
        `pre-build: ${repoKey} (${spec.language}) produced indexer="static" — the language server ` +
          `is missing or broken on this host. Install it or pass --allow-static=1.\n` +
          `warnings: ${(dump.warnings ?? []).join("; ")}`,
      );
    }
    console.log(
      `graph pre-built: ${dump.indexer}, ${dump.nodes.length} nodes / ${dump.edges.length} edges ` +
        `in ${(toolSetupMs / 1000).toFixed(0)}s -> ${graphFile}`,
    );
  }
  if (cg) {
    const started = Date.now();
    console.log(`codegraph init ${repoDir} ...`);
    runOrThrow("codegraph", ["init", repoDir], repoDir);
    toolSetupMs = Date.now() - started;
    console.log(`codegraph indexed in ${(toolSetupMs / 1000).toFixed(0)}s`);
  }
}

// 3. Minimal CODEX_HOME per arm: real auth.json + generated config.toml. TOML
// literal strings ('...') carry Windows paths verbatim with no escaping.
const realHome = path.join(os.homedir(), ".codex");
if (!fs.existsSync(path.join(realHome, "auth.json"))) {
  throw new Error(`codex is not logged in (missing ${path.join(realHome, "auth.json")})`);
}
const withHome = armsRequested.graph ? makeCodexHome("with", true) : null;
const withoutHome = armsRequested.baseline ? makeCodexHome("without", false) : null;
const arms = [
  { name: "baseline", home: withoutHome },
  { name: "graph", home: withHome },
].filter((a) => a.home);

console.log(
  `\nagent-cost A/B on ${repoKey} (${spec.language}) via codex — model ${model} (effort ${effort}), ` +
    `${runs} run(s) x ${arms.length} arm(s), prompt ${prompt.entry.id}, tool ${toolName}`,
);
console.log(`Q: ${question}\n`);

// A baseline-only run is tool-independent; name it so every tool's comparison
// can join against the same cached baseline instead of re-spending on it.
const reportTool = armsRequested.graph ? toolName : "baseline";
const resultsRoot = path.join(benchmarkDir, "results");
const reportPath = args.report
  ? path.resolve(args.report)
  : path.join(resultsRoot, `codex-${repoKey}-${family}-${reportTool}.json`);
const traceDir = path.join(
  path.dirname(reportPath),
  `${path.basename(reportPath, path.extname(reportPath))}.traces`,
);
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.rmSync(reportPath, { force: true });
fs.rmSync(traceDir, { recursive: true, force: true });
fs.mkdirSync(traceDir, { recursive: true });

const MAX_RUN_RETRIES = Number(args["max-run-retries"] ?? 4);
const samples = Object.fromEntries(arms.map((a) => [a.name, []]));
const concurrency = Number(process.env.SAMCHON_BENCH_CONCURRENCY) || 1;
const thunks = arms.flatMap((arm) =>
  Array.from({ length: runs }, (_, r) => async () => {
    // Validity is token-based: only a zero-token run (rate limit / capacity
    // failure) carries no usable sample and is retried in place. A run that
    // spent tokens is a real measurement and is kept.
    let m;
    let attempts = 0;
    for (let attempt = 0; attempt <= MAX_RUN_RETRIES; attempt++) {
      attempts = attempt + 1;
      m = await runCodex(question, arm.home, arm.name, r + 1);
      if (Number(m?.tokens ?? 0) > 0) break;
      if (attempt < MAX_RUN_RETRIES) {
        console.log(`  ${arm.name.padEnd(8)} run ${r + 1}: [FAILED]${m.error ? ` ${m.error}` : ""} retrying (${attempt + 1}/${MAX_RUN_RETRIES})`);
      }
    }
    m.promptId = prompt.entry.id;
    m.questionSha256 = prompt.entry.questionSha256;
    m.run = r + 1;
    m.attempts = attempts;
    samples[arm.name].push(m);
    console.log(
      `  ${arm.name.padEnd(8)} run ${r + 1}: ${m.tokens} tok` +
        (m.reasoning ? ` (+${m.reasoning} reasoning)` : "") +
        `, ${m.tools} tools (shell ${m.shell}, source ${m.sourceTouches}, graph ${m.graph}, web ${m.web}), ` +
        `${(m.durMs / 1000).toFixed(0)}s` +
        (m.ok ? "" : `  [FAILED${m.error ? `: ${m.error}` : ""}]`),
    );
  }),
);
await runWithConcurrency(thunks, concurrency);

const med = (arm, k) =>
  median((samples[arm] ?? []).filter((m) => Number(m?.tokens ?? 0) > 0).map((m) => m[k]));
const pct = (g, b) => (b === 0 ? 0 : Math.round((1 - g / b) * 100));
console.log(`\nMedian of ${runs} run(s), codex/${model}:`);
for (const [label, k, fmt] of [
  ["tokens", "tokens", (x) => x],
  ["tool calls", "tools", (x) => x],
  ["wall time", "durMs", (x) => `${(x / 1000).toFixed(0)}s`],
]) {
  if (armsRequested.baseline && armsRequested.graph) {
    console.log(`  ${label.padEnd(12)} baseline ${fmt(med("baseline", k))}  ->  ${toolName} ${fmt(med("graph", k))} (${pct(med("graph", k), med("baseline", k))}%)`);
  } else if (armsRequested.baseline) {
    console.log(`  ${label.padEnd(12)} baseline ${fmt(med("baseline", k))}`);
  } else {
    console.log(`  ${label.padEnd(12)} ${toolName} ${fmt(med("graph", k))}`);
  }
}

fs.writeFileSync(
  reportPath,
  `${JSON.stringify(
    {
      harness: "codex",
      tool: reportTool,
      ...(toolSetupMs !== undefined ? { toolSetupMs } : {}),
      repo: repoKey,
      language: spec.language,
      commit: spec.commit,
      repoDir,
      model,
      effort,
      promptId: prompt.entry.id,
      promptFamily: family,
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
for (const home of [withHome, withoutHome]) {
  if (home) fs.rmSync(home, { recursive: true, force: true });
}

function makeCodexHome(tag, withServer) {
  const home = path.join(os.tmpdir(), `codex-home-${tag}-${process.pid}`);
  fs.rmSync(home, { recursive: true, force: true });
  fs.mkdirSync(home, { recursive: true });
  fs.copyFileSync(path.join(realHome, "auth.json"), path.join(home, "auth.json"));
  let toml = `model = '${model}'\nmodel_reasoning_effort = '${effort}'\nweb_search = 'disabled'\n`;
  if (withServer) {
    if (cg) {
      const command = process.platform === "win32" ? "cmd.exe" : "codegraph";
      const cgArgs = (process.platform === "win32" ? ["/d", "/s", "/c", "codegraph"] : []).concat([
        "serve",
        "--mcp",
        "--path",
        repoDir,
      ]);
      toml += `\n[mcp_servers.codegraph]\ncommand = '${command}'\nargs = [${cgArgs.map((a) => `'${a}'`).join(", ")}]\nenv = { CODEGRAPH_NO_DAEMON = "1" }\n`;
    } else if (serena) {
      const serenaArgs = [
        "--from",
        "git+https://github.com/oraios/serena",
        "serena",
        "start-mcp-server",
        "--context",
        "codex",
        "--project",
        repoDir,
        "--enable-web-dashboard",
        "False",
        "--open-web-dashboard",
        "False",
        "--log-level",
        "WARNING",
      ];
      toml += `\n[mcp_servers.serena]\ncommand = '${serenaCommand}'\nargs = [${serenaArgs.map((a) => `'${a}'`).join(", ")}]\n`;
    } else {
      // Serve the pre-built dump: startup is instant and every call answers
      // from the full-density resident graph.
      const launcherArgs = [graphLauncher, "--graph-file", graphFile];
      toml += `\n[mcp_servers.samchon_graph]\ncommand = '${process.execPath}'\nargs = [${launcherArgs.map((a) => `'${a}'`).join(", ")}]\n`;
    }
    // Symmetric server timeouts for every tool arm: first calls may index or
    // resolve lazily.
    toml += `startup_timeout_sec = 60\ntool_timeout_sec = 300\n`;
  }
  validateMcpConfig(toml, withServer);
  fs.writeFileSync(path.join(home, "config.toml"), toml);
  return home;
}

function validateMcpConfig(toml, withServer) {
  if (!withServer) {
    if (toml.includes("[mcp_servers.")) throw new Error("baseline Codex config must not include an MCP server");
    return;
  }
  if ((cg || serena) && toml.includes("[mcp_servers.samchon_graph]")) {
    throw new Error("comparator Codex config must not include @samchon/graph");
  }
  if (cg && !toml.includes("[mcp_servers.codegraph]")) throw new Error("codegraph Codex config did not include codegraph");
  if (serena && !toml.includes("[mcp_servers.serena]")) throw new Error("serena Codex config did not include serena");
  if (!cg && !serena && !toml.includes("[mcp_servers.samchon_graph]")) {
    throw new Error("graph Codex config did not include @samchon/graph");
  }
}

async function runCodex(prompt, codexHome, armName, runNumber) {
  const start = Date.now();
  const result = await spawnAsync(
    "codex",
    [
      "exec",
      "--json",
      "-c",
      "web_search=disabled",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      "--ephemeral",
      "--strict-config",
      "-C",
      repoDir,
    ],
    {
      input: prompt,
      windowsHide: true,
      shell: true,
      timeout: codexRunTimeoutMs,
      env: { ...process.env, CODEX_HOME: codexHome },
    },
  );
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const base = `${armName}-run-${runNumber}`;
  fs.writeFileSync(path.join(traceDir, `${base}.stream.jsonl`), stdout);
  if (stderr) fs.writeFileSync(path.join(traceDir, `${base}.stderr.log`), stderr);
  if (result.error) {
    return { ...emptySample(Date.now() - start), error: String(result.error.message).slice(0, 160) };
  }
  const parsed = parseStream(stdout, Date.now() - start);
  if (result.status && result.status !== 0) {
    parsed.ok = false;
    parsed.error = `codex exited ${result.status}${stderr ? `: ${oneLine(stderr).slice(0, 160)}` : ""}`;
  } else if (!parsed.ok && stderr && !parsed.error) {
    parsed.error = oneLine(stderr).slice(0, 160);
  }
  return parsed;
}

function emptySample(durMs) {
  return { tokens: 0, cached: 0, reasoning: 0, tokensWithReasoning: 0, turns: 0, usage: [], tools: 0, shell: 0, graph: 0, web: 0, sourceTouches: 0, shellCommands: [], types: {}, durMs, ok: false, answer: "", error: "" };
}

function spawnAsync(command, commandArgs, { input, ...spawnOpts }) {
  return new Promise((resolve) => {
    const child = cp.spawn(command, commandArgs, spawnOpts);
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));
    child.on("error", (error) => resolve({ error, stdout, stderr }));
    child.on("close", (status, signal) => resolve({ stdout, stderr, status, signal }));
    if (input) {
      child.stdin?.write(input);
      child.stdin?.end();
    } else {
      child.stdin?.end();
    }
  });
}

// parseStream sums per-turn usage (input + output) across turn.completed events
// and counts tool calls from item.completed events, mirroring ttsc's parser:
// command_execution (shell reads/greps, classified further into source
// inspections) and mcp_tool_call (graph). The last agent_message is the answer.
function parseStream(text, durMs) {
  let tokens = 0, cached = 0, reasoning = 0, turns = 0, tools = 0, shell = 0, graph = 0, web = 0, sourceTouches = 0;
  let completed = false, answered = false, answer = "";
  const usage = [];
  const types = {};
  const shellCommands = [];
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    let e;
    try {
      e = JSON.parse(raw);
    } catch {
      continue;
    }
    if (e.type === "turn.completed") {
      completed = true;
      const u = e.usage || {};
      const turn = {
        input: u.input_tokens || 0,
        cachedInput: u.cached_input_tokens || 0,
        output: u.output_tokens || 0,
        reasoning: u.reasoning_output_tokens || 0,
      };
      tokens += turn.input + turn.output;
      cached += turn.cachedInput;
      reasoning += turn.reasoning;
      usage.push(turn);
      turns++;
    } else if (e.type === "item.completed") {
      const it = e.item || {};
      const t = it.type || "?";
      types[t] = (types[t] || 0) + 1;
      if (t === "mcp_tool_call") {
        tools++;
        graph++;
      } else if (t === "command_execution") {
        tools++;
        shell++;
        const command = it.command ?? "";
        shellCommands.push(command);
        if (sourceInspectionCommand(command)) sourceTouches++;
      } else if (t === "web_search") {
        tools++;
        web++;
      } else if (t === "agent_message") {
        answered = true;
        if (typeof it.text === "string" && it.text.trim()) answer = it.text;
      }
    }
  }
  return {
    tokens,
    cached,
    reasoning,
    tokensWithReasoning: tokens + reasoning,
    turns,
    usage,
    tools,
    shell,
    graph,
    web,
    sourceTouches,
    shellCommands: shellCommands.slice(-20),
    types,
    durMs,
    ok: completed && answered,
    answer,
    error: completed ? (answered ? "" : "codex completed without an agent answer") : "codex turn did not complete",
  };
}

function sourceInspectionCommand(command) {
  return (
    /\b(git\s+grep|rg|grep|Select-String|findstr)\b/i.test(command) ||
    /\b(Get-Content|gc|cat|type|sed|awk|head|tail)\b/i.test(command) ||
    (/\b(git\s+ls-files|Get-ChildItem|gci|ls|dir)\b/i.test(command) &&
      /\b(src|packages|apps|lib|server|client|test)\b/i.test(command))
  );
}

async function runWithConcurrency(work, limit) {
  let next = 0;
  const worker = async () => {
    while (next < work.length) await work[next++]();
  };
  const lanes = Math.max(1, Math.min(limit, work.length));
  await Promise.all(Array.from({ length: lanes }, worker));
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

function oneLine(value) {
  return String(value).replace(/\s+/g, " ").trim();
}
