import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { buildGraphDump } from "@samchon/graph";

import { findExperiment } from "./catalog.mjs";
import { cloneRepository, ensureDir, parseArgs, resultsRoot } from "./process.mjs";

const require = createRequire(import.meta.url);
const args = parseArgs(process.argv.slice(2));
const experiment = findExperiment(args.language);
const cwd = cloneRepository(experiment, { refresh: args.refresh === "true" });

const typescriptLanguageServerEntry = () =>
  path.join(
    path.dirname(require.resolve("typescript-language-server/package.json")),
    "lib",
    "cli.mjs",
  );

const typescriptTsserverPath = () =>
  path.join(path.dirname(require.resolve("typescript/package.json")), "lib", "tsserver.js");

const serverFor = (language) => {
  if (language === "typescript" || language === "javascript") {
    return {
      server: process.execPath,
      serverArgs: [typescriptLanguageServerEntry(), "--stdio"],
      initializationOptions: {
        tsserver: {
          path: typescriptTsserverPath(),
        },
      },
    };
  }
  return {};
};

const started = performance.now();
const dump = await buildGraphDump({
  cwd,
  mode: "lsp",
  languages: [experiment.language],
  maxFiles: experiment.maxFiles,
  ...(experiment.timeoutMs !== undefined ? { lspTimeoutMs: experiment.timeoutMs } : {}),
  ...serverFor(experiment.language),
});
const elapsedMs = Math.round(performance.now() - started);
const warnings = dump.warnings ?? [];

if (dump.indexer === "static") {
  throw new Error(`${experiment.language}: expected real LSP indexing, got static fallback: ${warnings.join("; ")}`);
}
if (dump.languages.includes(experiment.language) === false) {
  throw new Error(`${experiment.language}: dump languages did not include ${experiment.language}`);
}
if (dump.nodes.length < experiment.minNodes) {
  throw new Error(`${experiment.language}: expected at least ${experiment.minNodes} nodes, got ${dump.nodes.length}`);
}
const minEdges = experiment.minEdges ?? 0;
if (dump.edges.length < minEdges) {
  throw new Error(`${experiment.language}: expected at least ${minEdges} relationship edges, got ${dump.edges.length}`);
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
