import assert from "node:assert/strict";
import cp from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CORPUS, PROJECTS, projectDir } from "../graph/corpus.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const benchmarkDir = path.resolve(here, "..");
const repoRoot = path.resolve(benchmarkDir, "..", "..");
const graphDir = path.join(benchmarkDir, "graph");
const manifestPath = path.join(graphDir, "questions", "manifest.json");

testCorpusAndPromptProvenance();
testManifestGenerationIsDeterministic();
testCodexTraceAuditor();
testReferenceRenderer();
console.log("benchmark system tests: ok");

function testCorpusAndPromptProvenance() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(CORPUS.length, 13);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.prompts.length, CORPUS.length * 2);
  assert.deepEqual(Object.keys(PROJECTS), CORPUS.map((entry) => entry.name));
  for (const spec of CORPUS) {
    assert.match(spec.commit, /^[0-9a-f]{40}$/);
    assert.equal(PROJECTS[spec.name].sourceRepo, spec.url);
    assert.equal(PROJECTS[spec.name].sourceBranch, spec.commit);
    assert.equal(
      projectDir("C:/work", spec).replace(/\\/g, "/"),
      `C:/work/${spec.name}@${spec.commit.slice(0, 12)}`,
    );
    for (const family of ["dedicated", "common"]) {
      const prompt = manifest.prompts.find(
        (entry) => entry.repo === spec.name && entry.family === family,
      );
      assert.ok(prompt, `${spec.name}/${family} prompt is present`);
      assert.equal(prompt.fixtureCommit, spec.commit);
      assert.equal(prompt.language, spec.language);
      const text = fs
        .readFileSync(path.join(graphDir, "questions", prompt.file), "utf8")
        .replace(/\r\n/g, "\n")
        .trim();
      assert.equal(sha256(text), prompt.questionSha256);
    }
  }
}

function testManifestGenerationIsDeterministic() {
  const before = fs.readFileSync(manifestPath);
  run(process.execPath, [path.join(graphDir, "generate-manifest.mjs")]);
  const after = fs.readFileSync(manifestPath);
  assert.deepEqual(after, before);
}

function testCodexTraceAuditor() {
  run(process.execPath, [path.join(graphDir, "audit-codex-traces.mjs"), "--self-test"]);
}

function testReferenceRenderer() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-render-"));
  const input = path.join(root, "graph.json");
  const out = path.join(root, "out");
  fs.writeFileSync(input, JSON.stringify(sampleReport()));
  const env = {
    ...process.env,
    SAMCHON_GRAPH_BENCH_INPUT: input,
    SAMCHON_GRAPH_BENCH_RENDER_OUT: out,
  };
  run(
    process.execPath,
    [path.join(benchmarkDir, "build", "graph-benchmark-svg.cjs"), "--png"],
    env,
  );
  const first = snapshot(out);
  const chartNames = [
    "graph-common-codex-gpt-5.6-terra",
    "graph-excalidraw-common-codex-gpt-5.6-terra",
    "graph-gin-common-codex-gpt-5.6-terra",
    "graph-time-to-answer",
  ];
  assert.deepEqual(
    [...first.keys()],
    [
      ...chartNames.map((name) => `png/${name}.png`),
      ...chartNames.map((name) => `svg/${name}.svg`),
    ].sort(),
    "the reference renderer emits the grouped, per-repo, and time charts in both formats",
  );
  run(
    process.execPath,
    [path.join(benchmarkDir, "build", "graph-benchmark-svg.cjs"), "--png"],
    env,
  );
  assert.deepEqual(snapshot(out), first, "renderer output is byte deterministic");

  const grouped = fs.readFileSync(
    path.join(out, "svg", `${chartNames[0]}.svg`),
    "utf8",
  );
  for (const label of [
    "baseline",
    "@samchon/graph",
    "codegraph",
    "codebase-memory",
    "serena",
  ])
    assert.match(grouped, new RegExp(escapeRegExp(label)));
  assert.match(
    grouped,
    /M2\.5 5\.5 5\.4 8l2\.6-4/,
    "the reference crown geometry marks the winner",
  );

  const time = fs.readFileSync(
    path.join(out, "svg", "graph-time-to-answer.svg"),
    "utf8",
  );
  assert.match(time, /Cold time to a first answer/);
  assert.match(time, /faded = index build, solid = LLM answering/);
  assert.match(time, /20,000 lines/);

  for (const [relative] of first) {
    if (!relative.endsWith(".svg")) continue;
    const svg = fs.readFileSync(path.join(out, relative), "utf8");
    assert.match(svg, /<svg\b/);
    assert.match(svg, /DejaVu Sans, Arial/);
    const width = Number(svg.match(/<svg[^>]*width="([\d.]+)"/)?.[1]);
    const height = Number(svg.match(/<svg[^>]*height="([\d.]+)"/)?.[1]);
    const png = fs.readFileSync(
      path.join(out, relative.replace(/^svg[\\/]/, "png/").replace(/\.svg$/, ".png")),
    );
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(png.readUInt32BE(16), width * 2);
    assert.equal(png.readUInt32BE(20), height * 2);
  }
  fs.rmSync(root, { recursive: true, force: true });
}

function sampleReport() {
  const cells = [];
  for (const [repo, baseline, graph] of [
    ["excalidraw", 10_000, 3_000],
    ["gin", 8_000, 2_800],
  ]) {
    const base = {
      harness: "codex",
      repo,
      model: "terra",
      modelVersion: "gpt-5.6-terra",
      promptFamily: "common",
    };
    cells.push({
      ...base,
      tool: "baseline",
      samples: { baseline: [{ tokens: baseline, durMs: 20_000 }], graph: [] },
    });
    for (const [tool, value, durMs] of [
      ["samchon-graph", graph, 9_000],
      ["codegraph", graph + 500, 11_000],
      ["codebase-memory", graph + 900, 13_000],
      ["serena", graph + 1_200, 15_000],
    ])
      cells.push({
        ...base,
        tool,
        samples: { baseline: [], graph: [{ tokens: value, durMs }] },
      });
  }
  return {
    schemaVersion: 1,
    agent: { cells },
    index: {
      host: { cpu: "test", cores: 8, ramGB: 32, os: "test" },
      scale: {
        excalidraw: { files: 100, lines: 20_000 },
        gin: { files: 80, lines: 12_000 },
      },
      cells: ["excalidraw", "gin"].flatMap((project, projectIndex) =>
        ["samchon-graph", "codegraph", "codebase-memory", "serena"].map(
          (tool, toolIndex) => ({
            project,
            tool,
            buildMs: 1_000 + projectIndex * 500 + toolIndex * 200,
          }),
        ),
      ),
    },
  };
}

function snapshot(root) {
  const entries = [];
  for (const file of walk(root)) {
    const relative = path.relative(root, file).replace(/\\/g, "/");
    entries.push([relative, sha256(fs.readFileSync(file))]);
  }
  return new Map(entries);
}

function walk(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(root, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

function run(command, args, env = process.env) {
  const result = cp.spawnSync(command, args, {
    cwd: repoRoot,
    env,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status})\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
