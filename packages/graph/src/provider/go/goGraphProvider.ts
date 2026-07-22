import { spawnSync } from "node:child_process";
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
    providerInputFiles(
      root,
      ["go"],
      GO_BUILD_FILE_NAMES,
      GO_AUXILIARY_EXTENSIONS,
    ),
    vendorInputs(root),
  );
}

/** Compiler-owned Go workspace snapshots enriched through go/packages. */
export const goGraphProvider = Object.assign(
  sidecarProvider({
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
    resolve: resolveGoGraphCommand,
    indexArgs: goIndexArgs,
    inputs: goInputs,
    configuration: goConfiguration,
  }),
  {
    indexArgs: goIndexArgs,
    inputs: goInputs,
    configuration: goConfiguration,
  },
);

function resolveGoGraphCommand(
  root: string,
  env: NodeJS.ProcessEnv,
): { command: string; args: string[] } | undefined {
  const installed = resolveProviderCommand(root, env, {
    command: "samchon-graph-go",
    override: "SAMCHON_GRAPH_GO",
  });
  if (installed !== undefined) return installed;
  const source = path.resolve(__dirname, "..", "..", "..", "sidecars", "go");
  if (!fs.existsSync(path.join(source, "go.mod"))) return undefined;
  const go = resolveProviderCommand(root, env, {
    command: "go",
    override: "SAMCHON_GRAPH_GO_TOOLCHAIN",
  });
  return go === undefined
    ? undefined
    : {
        command: go.command,
        args: [...go.args, "-C", source, "run", "."],
      };
}

function goBuildInputs(root: string): string[] {
  return mergeInputs(
    providerInputFiles(
      root,
      [],
      GO_BUILD_FILE_NAMES,
      GO_AUXILIARY_EXTENSIONS,
    ),
    vendorInputs(root),
  );
}

function mergeInputs(...groups: (readonly string[])[]): string[] {
  return [...new Set(groups.flat())].sort(compareOrdinal);
}

function vendorInputs(root: string): string[] {
  const resolved = path.resolve(root);
  const moduleRoots = [
    ...new Set([
      resolved,
      ...providerInputFiles(root, [], ["go.mod"]).map((file) =>
        path.dirname(path.resolve(resolved, file)),
      ),
    ]),
  ];
  const modules = moduleRoots
    .map((directory) => path.join(directory, "vendor"))
    .filter(
      (directory) =>
        fs.existsSync(directory) && fs.statSync(directory).isDirectory(),
    )
    .flatMap((directory) =>
      allRegularFiles(directory).map((file) =>
        normalizePath(path.relative(resolved, path.resolve(directory, file))),
      ),
    );
  return [...new Set(modules)].sort(compareOrdinal);
}

function allRegularFiles(root: string): string[] {
  const output: string[] = [];
  const visit = (directory: string): void => {
    const entries = fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => compareOrdinal(left.name, right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory() && entry.name !== ".git") visit(absolute);
      else if (entry.isFile()) output.push(absolute);
    }
  };
  visit(root);
  return output;
}

function compareOrdinal(left: string, right: string): number {
  /* c8 ignore next 2 -- input sets contain distinct normalized paths. */
  return left < right ? -1 : left > right ? 1 : 0;
}

function goConfiguration(
  root: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const rows = GO_ENVIRONMENT_KEYS.map((key) => `${key}=${env[key] ?? ""}`);
  const go = resolveProviderCommand(root, env, {
    command: "go",
    override: "SAMCHON_GRAPH_GO_TOOLCHAIN",
  });
  if (go === undefined) return [...rows, "go-env=unavailable"];
  const probed = spawnSync(
    go.command,
    [...go.args, "env", "-json", ...GO_PROBED_ENVIRONMENT_KEYS],
    {
      cwd: root,
      env,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: 10_000,
      windowsHide: true,
    },
  );
  return [
    ...rows,
    probed.status === 0
      ? `go-env=${probed.stdout.trim()}`
      : "go-env=unavailable",
  ];
}

const GO_BUILD_FILE_NAMES: readonly string[] = [
  "go.mod",
  "go.sum",
  "go.work",
  "go.work.sum",
];

// Files the Go command accepts beside .go sources. They can alter cgo types,
// assembly linkage, generated SWIG declarations, or the selected object file
// without changing one byte in a .go file.
const GO_AUXILIARY_EXTENSIONS: readonly string[] = [
  ".c",
  ".cc",
  ".cpp",
  ".cxx",
  ".f",
  ".for",
  ".f90",
  ".h",
  ".hh",
  ".hpp",
  ".hxx",
  ".m",
  ".s",
  ".sx",
  ".swig",
  ".swigcxx",
  ".syso",
];

const GO_ENVIRONMENT_KEYS: readonly string[] = [
  "CGO_ENABLED",
  "CGO_CFLAGS",
  "CGO_CPPFLAGS",
  "CGO_CXXFLAGS",
  "CGO_FFLAGS",
  "CGO_LDFLAGS",
  "CC",
  "CXX",
  "FC",
  "GO111MODULE",
  "GOARCH",
  "GO386",
  "GOAMD64",
  "GOARM",
  "GOARM64",
  "GOENV",
  "GODEBUG",
  "GOEXPERIMENT",
  "GOFIPS140",
  "GOFLAGS",
  "GONOPROXY",
  "GONOSUMDB",
  "GOOS",
  "GOMIPS",
  "GOMIPS64",
  "GOPPC64",
  "GORISCV64",
  "GOWASM",
  "GOPATH",
  "GOPRIVATE",
  "GOPROXY",
  "GOSUMDB",
  "GOTOOLCHAIN",
  "GOWORK",
  "PATH",
  "SAMCHON_GRAPH_SCIP_GO",
  "SAMCHON_GRAPH_GO_TOOLCHAIN",
  "PKG_CONFIG",
];

const GO_PROBED_ENVIRONMENT_KEYS: readonly string[] = [
  "GOVERSION",
  "GOOS",
  "GOARCH",
  "CGO_ENABLED",
  "CGO_CFLAGS",
  "CGO_CPPFLAGS",
  "CGO_CXXFLAGS",
  "CGO_FFLAGS",
  "CGO_LDFLAGS",
  "CC",
  "CXX",
  "FC",
  "GO111MODULE",
  "GOFLAGS",
  "GO386",
  "GOAMD64",
  "GOARM",
  "GOARM64",
  "GOWORK",
  "GOENV",
  "GODEBUG",
  "GOEXPERIMENT",
  "GOFIPS140",
  "GOMIPS",
  "GOMIPS64",
  "GOPPC64",
  "GORISCV64",
  "GOWASM",
  "GOTOOLCHAIN",
  "GOPROXY",
  "GOPRIVATE",
  "PKG_CONFIG",
];
