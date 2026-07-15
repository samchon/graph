// Structural benchmark for @samchon/graph. This is the multi-language analogue
// of @ttsc/graph's graphbench: deterministic graph counts and fair cross-file
// coverage, plus indicative cold index time on a quiet host.
//
// Usage:
//   node tests/benchmark/graph/bench.mjs --project=/abs/path --language=typescript --runs=5
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildGraphDump } from "@samchon/graph";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const args = parseArgs(process.argv.slice(2));
const project = path.resolve(args.project ?? path.join(repoRoot, "packages", "graph"));
const language = args.language ?? "typescript";
const mode = args.mode ?? "lsp";
const runs = Number(args.runs ?? 5);
const warmup = Number(args.warmup ?? 1);

console.log(
  `Benchmarking @samchon/graph on ${path.relative(repoRoot, project) || project} ` +
    `(${language}/${mode}), ${runs} run(s) + ${warmup} warmup\n`,
);

for (let i = 0; i < warmup; i++) await measure();
const samples = [];
for (let i = 0; i < runs; i++) {
  const sample = await measure();
  samples.push(sample);
  console.log(
    `  run ${i + 1}: index ${sample.indexMs.toFixed(0)}ms, ` +
      `${sample.nodes} nodes, ${sample.totalEdges} edges, ` +
      `coverage ${(sample.coverage * 100).toFixed(1)}%`,
  );
}

const first = samples[0];
const report = {
  project: path.relative(repoRoot, project) || project,
  language,
  mode,
  runs,
  indexer: first.indexer,
  sourceFiles: first.sourceFiles,
  nodes: first.nodes,
  externalNodes: first.externalNodes,
  edges: first.edges,
  totalEdges: first.totalEdges,
  symbolFiles: first.symbolFiles,
  coveredFiles: first.coveredFiles,
  coverage: first.coverage,
  indexMsMedian: median(samples.map((sample) => sample.indexMs)),
};

console.log("\nResult (counts deterministic; timing indicative):");
console.log(`  source files:  ${report.sourceFiles}`);
console.log(`  nodes:         ${report.nodes} (${report.externalNodes} external boundary leaves)`);
console.log(
  `  edges:         ${report.totalEdges} (heritage ${report.edges.heritage}, ` +
    `value-call ${report.edges["value-call"]}, type-ref ${report.edges["type-ref"]})`,
);
console.log(
  `  fair coverage: ${(report.coverage * 100).toFixed(1)}% ` +
    `(${report.coveredFiles}/${report.symbolFiles} symbol-bearing files cross-linked)`,
);
console.log(`  cold index:    ${report.indexMsMedian.toFixed(0)} ms (median)`);

const reportPath = path.join(here, "report.json");
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nReport: ${path.relative(repoRoot, reportPath)}`);

async function measure() {
  const started = performance.now();
  const dump = await buildGraphDump({
    cwd: project,
    mode,
    languages: [language],
  });
  const indexMs = performance.now() - started;
  const nodesById = new Map(dump.nodes.map((node) => [node.id, node]));
  const projectNodes = dump.nodes.filter((node) => !node.external);
  const symbolFiles = new Set(projectNodes.map((node) => node.file));
  const coveredFiles = new Set();
  const edges = { heritage: 0, "value-call": 0, "type-ref": 0 };
  for (const edge of dump.edges) {
    const family = displayKind(edge.kind);
    if (Object.hasOwn(edges, family)) edges[family]++;
    const from = nodesById.get(edge.from);
    const to = nodesById.get(edge.to);
    if (from && to && !from.external && !to.external && from.file !== to.file) {
      coveredFiles.add(from.file);
      coveredFiles.add(to.file);
    }
  }
  return {
    indexer: dump.indexer,
    indexMs,
    sourceFiles: symbolFiles.size,
    nodes: dump.nodes.length,
    externalNodes: dump.nodes.length - projectNodes.length,
    edges,
    totalEdges: dump.edges.length,
    symbolFiles: symbolFiles.size,
    coveredFiles: coveredFiles.size,
    coverage: symbolFiles.size === 0 ? 0 : coveredFiles.size / symbolFiles.size,
  };
}

function displayKind(kind) {
  if (["calls", "instantiates", "renders", "accesses"].includes(kind))
    return "value-call";
  if (kind === "type_ref") return "type-ref";
  if (kind === "extends" || kind === "implements") return "heritage";
  return kind;
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue;
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) out[match[1]] = match[2];
    else if (arg.startsWith("--")) out[arg.slice(2)] = argv[++i] ?? "true";
  }
  return out;
}
