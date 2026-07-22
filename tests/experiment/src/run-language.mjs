import fs from "node:fs";
import path from "node:path";

import { buildGraphDump } from "@samchon/graph";

import { findExperiment } from "./catalog.mjs";
import { cloneRepository, ensureDir, parseArgs, resultsRoot, shell } from "./process.mjs";

const args = parseArgs(process.argv.slice(2));
const experiment = findExperiment(args.language);
const cwd = cloneRepository(experiment, { refresh: args.refresh === "true" });
// Some language servers need the checkout prepared before they can boot —
// ruby-lsp, for one, composes a bundle from the project's Gemfile.
if (experiment.prepare !== undefined) shell(experiment.prepare, { cwd });

const started = performance.now();
const strict = experiment.strictProvider !== undefined;
const dump = await buildGraphDump({
  cwd,
  mode: "lsp",
  languages: [experiment.language],
  ...(strict
    ? {}
    : {
        maxFiles: experiment.maxFiles,
        lspReferenceLimit: experiment.referenceLimit ?? 250,
      }),
  lspTimeoutMs: experiment.timeoutMs ?? 60_000,
  lspReadyTimeoutMs: experiment.readyTimeoutMs ?? 180_000,
  lspWarmupTimeoutMs: experiment.warmupTimeoutMs ?? 180_000,
});
const elapsedMs = Math.round(performance.now() - started);
const warnings = dump.warnings ?? [];

if (dump.indexer === "static") {
  throw new Error(`${experiment.language}: expected real LSP indexing, got static fallback: ${warnings.join("; ")}`);
}
if (dump.languages.includes(experiment.language) === false) {
  throw new Error(`${experiment.language}: dump languages did not include ${experiment.language}`);
}
if (!strict && dump.nodes.length < experiment.minNodes) {
  throw new Error(`${experiment.language}: expected at least ${experiment.minNodes} nodes, got ${dump.nodes.length}`);
}
const minEdges = experiment.minEdges ?? 0;
if (!strict && dump.edges.length < minEdges) {
  throw new Error(`${experiment.language}: expected at least ${minEdges} relationship edges, got ${dump.edges.length}`);
}
const provenance = strict
  ? dump.provenance?.find((row) => row.provider === experiment.strictProvider)
  : undefined;
if (strict && provenance === undefined) {
  throw new Error(
    `${experiment.language}: strict provider ${experiment.strictProvider} did not publish provenance: ${warnings.join("; ")}`,
  );
}
if (
  provenance !== undefined &&
  (provenance.authority !== "compiler" ||
    provenance.producer.tool !== experiment.strictProvider ||
    provenance.producer.version === "" ||
    provenance.producer.compiler === "" ||
    !provenance.capabilities.includes("sourceDigests") ||
    !provenance.capabilities.includes("fullRebuild"))
) {
  throw new Error(
    `${experiment.language}: strict provenance is incomplete: ${JSON.stringify(provenance)}`,
  );
}
const edgeKindCounts = Object.fromEntries(
  [...new Set(dump.edges.map((edge) => edge.kind))]
    .sort()
    .map((kind) => [
      kind,
      dump.edges.filter((edge) => edge.kind === kind).length,
    ]),
);
for (const kind of experiment.semanticEdges ?? []) {
  if ((edgeKindCounts[kind] ?? 0) === 0) {
    throw new Error(
      `${experiment.language}: strict corpus produced no ${kind} semantic edge`,
    );
  }
}
const nodeFiles = new Map(dump.nodes.map((node) => [node.id, node.file]));
const crossFileCalls = dump.edges.filter(
  (edge) =>
    edge.kind === "calls" &&
    nodeFiles.get(edge.from) !== undefined &&
    nodeFiles.get(edge.to) !== undefined &&
    nodeFiles.get(edge.from) !== nodeFiles.get(edge.to),
).length;
if (strict && crossFileCalls === 0) {
  throw new Error(
    `${experiment.language}: strict corpus produced no cross-file call`,
  );
}
console.log(`${experiment.language}: ${dump.nodes.length} nodes, ${dump.edges.length} edges (indexer=${dump.indexer}).`);
if (warnings.some((warning) => /LSP indexing failed|LSP returned no symbols|server not found/.test(warning))) {
  throw new Error(`${experiment.language}: LSP warning failed experiment: ${warnings.join("; ")}`);
}

ensureDir(resultsRoot);
const result = {
  language: experiment.language,
  repository: experiment.repository,
  project: cwd,
  indexer: dump.indexer,
  elapsedMs,
  nodeCount: dump.nodes.length,
  edgeCount: dump.edges.length,
  diagnosticCount: dump.diagnostics?.length ?? 0,
  strictProvider: experiment.strictProvider,
  provenance,
  edgeKindCounts,
  crossFileCalls,
  warnings,
  sampleNodes: dump.nodes.slice(0, 20).map((node) => ({
    id: node.id,
    kind: node.kind,
    name: node.qualifiedName ?? node.name,
    file: node.file,
  })),
};
const out = path.join(resultsRoot, `${experiment.language}.json`);
fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
