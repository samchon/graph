import fs from "node:fs";
import path from "node:path";

import { GraphEdgeKind } from "../../typings";
import { normalizePath } from "../../utils/normalizePath";
import { providerInputFiles } from "../providerInputFiles";
import { resolveProviderCommand } from "../resolveProviderCommand";
import { sidecarProvider } from "../sidecar";

function goIndexArgs(artifact: string): string[] {
  return [`--output=${artifact}`];
}

function goInputs(root: string): string[] {
  return mergeInputs(
    providerInputFiles(root, ["go"], GO_BUILD_FILE_NAMES),
    vendorManifests(root),
  );
}

/** Compiler-owned Go workspace snapshots enriched through go/packages. */
export const goGraphProvider = sidecarProvider({
  name: "samchon-graph-go",
  languages: ["go"],
  authority: "compiler",
  facts: [
    "contains",
    "exports",
    "imports",
    "calls",
    "accesses",
    "instantiates",
    "type_ref",
    "implements",
    "dispatches",
    "tests",
    "references",
  ] satisfies readonly GraphEdgeKind[],
  buildInputs: goBuildInputs,
  resolve: (root, env) =>
    resolveProviderCommand(root, env, {
      command: "samchon-graph-go",
      override: "SAMCHON_GRAPH_GO",
    }),
  indexArgs: goIndexArgs,
  inputs: goInputs,
  configuration: goConfiguration,
});

export namespace goGraphProvider {
  export const indexArgs = goIndexArgs;
  export const inputs = goInputs;
  export const configuration = goConfiguration;
}

function goBuildInputs(root: string): string[] {
  return mergeInputs(
    providerInputFiles(root, [], GO_BUILD_FILE_NAMES),
    vendorManifests(root),
  );
}

function mergeInputs(...groups: readonly (readonly string[])[]): string[] {
  return [...new Set(groups.flat())].sort(compareOrdinal);
}

function vendorManifests(root: string): string[] {
  const resolved = path.resolve(root);
  const modules = providerInputFiles(root, [], ["go.mod"])
    .map((file) => path.dirname(path.resolve(resolved, file)))
    .map((directory) => path.join(directory, "vendor", "modules.txt"))
    .filter((file) => fs.existsSync(file))
    .map((file) => normalizePath(path.relative(resolved, file)));
  return [...new Set(modules)].sort(compareOrdinal);
}

function compareOrdinal(left: string, right: string): number {
  /* c8 ignore next 2 -- input sets contain distinct normalized paths. */
  return left < right ? -1 : left > right ? 1 : 0;
}

function goConfiguration(): string[] {
  return GO_ENVIRONMENT_KEYS.map(
    (key) => `${key}=${process.env[key] ?? ""}`,
  );
}

const GO_BUILD_FILE_NAMES: readonly string[] = [
  "go.mod",
  "go.sum",
  "go.work",
  "go.work.sum",
];

const GO_ENVIRONMENT_KEYS: readonly string[] = [
  "CGO_ENABLED",
  "GOARCH",
  "GOENV",
  "GOEXPERIMENT",
  "GOFLAGS",
  "GONOPROXY",
  "GONOSUMDB",
  "GOOS",
  "GOPATH",
  "GOPRIVATE",
  "GOPROXY",
  "GOSUMDB",
  "GOTOOLCHAIN",
  "GOWORK",
  "PATH",
  "SAMCHON_GRAPH_SCIP_GO",
];
