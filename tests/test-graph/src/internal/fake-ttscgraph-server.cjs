const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");

const args = process.argv.slice(2);
const cwdIndex = args.indexOf("--cwd");
const project = cwdIndex === -1 ? process.cwd() : path.resolve(args[cwdIndex + 1]);
const invalidMode = args.find((arg) => arg.startsWith("--invalid"));
const markerArg = args.find((arg) => arg.startsWith("--marker="));
const marker = markerArg?.slice("--marker=".length);
const requestLogArg = args.find((arg) => arg.startsWith("--request-log="));
const requestLog = requestLogArg?.slice("--request-log=".length);
// Stands in for a producer that speaks a protocol this client refuses, so the
// pin can be proved without shipping a second fake.
const protocolArg = args.find((arg) => arg.startsWith("--protocol="));
const protocolVersion =
  protocolArg === undefined ? 1 : Number(protocolArg.slice("--protocol=".length));
// Drops one capability, so the client's degrade-and-say-so paths are reachable.
const dropArg = args.find((arg) => arg.startsWith("--drop-capability="));
const dropped = dropArg?.slice("--drop-capability=".length);
// Moves the build universe under an `incremental` label — a producer claiming it
// reused a program whose own inputs say it could not have.
const universeDrift = args.includes("--universe-drift");
let requests = 0;

const CAPABILITIES = [
  "universe",
  "sourceDigests",
  "diskDigests",
  "diagnostics",
].filter((capability) => capability !== dropped);

// Every workspace file the fake program loaded. The manifest must cover every
// file the nodes below name, because that is exactly what the client checks.
const WORKSPACE_FILES = ["src/index.ts", "src/core/order.ts", "src/empty.ts"];

const digestOf = (text) =>
  crypto.createHash("sha256").update(text).digest("hex");

const readProjectFile = (rel) => {
  try {
    return fs.readFileSync(path.join(project, rel), "utf8");
  } catch {
    return undefined;
  }
};

/**
 * The source manifest.
 *
 * `checkerDigest` is what the producer's checker parsed, and the fake reports it
 * whether or not the file is on disk right now — that is the property under
 * test. A real `ttscgraph` answers from the Program it holds; neither it nor
 * this fake needs the client to go looking on disk, and a file the client cannot
 * read still has a perfectly well-defined digest here.
 */
const manifest = (drift) =>
  WORKSPACE_FILES.map((file) => {
    const text = readProjectFile(file);
    return {
      file,
      checkerDigest: digestOf(text ?? `absent:${file}${drift ?? ""}`),
      diskDigest:
        dropped === "diskDigests" || text === undefined ? "" : digestOf(text),
    };
  });

const universe = (drift) => ({
  configs: [
    {
      file: "tsconfig.json",
      digest: digestOf(`${readProjectFile("tsconfig.json") ?? ""}${drift ?? ""}`),
    },
  ],
  roots: WORKSPACE_FILES.map((file) => ({ config: "tsconfig.json", file })),
});

const provenance = (drift) => ({
  schemaVersion: 1,
  capabilities: CAPABILITIES,
  producer: {
    tool: "ttscgraph",
    version: "0.19.2",
    typescript: "5.9.0",
  },
  universe: universe(drift),
  sources: manifest(drift),
});

const graph = (name, options = {}) => ({
  project,
  tsconfig: "tsconfig.json",
  provenance: provenance(options.drift),
  diagnostics:
    dropped === "diagnostics"
      ? []
      : [
          {
            file: "src/core/order.ts",
            line: 1,
            column: 1,
            code: 2322,
            category: "error",
            message: `synthetic finding for ${name}`,
          },
        ],
  nodes: [
    {
      id: "src/index.ts#src/index.ts:module",
      kind: "module",
      name: "src/index.ts",
      file: "src/index.ts",
      external: false,
    },
    {
      id: `src/core/order.ts#${name}:function`,
      kind: "function",
      name,
      file: "src/core/order.ts",
      external: false,
      exported: true,
      closure: true,
      ignored: true,
      modifiers: ["export", "async"],
      decorators: [{ name: "Route", arguments: [{ literal: 1 }] }],
      evidence: { startLine: 1, startCol: 1, endLine: 1, endCol: 10 },
    },
    {
      id: "src/core/order.ts#src/core/order.ts:module",
      kind: "module",
      name: "src/core/order.ts",
      file: "src/core/order.ts",
      external: false,
    },
    {
      id: "src/empty.ts#src/empty.ts:module",
      kind: "module",
      name: "src/empty.ts",
      file: "src/empty.ts",
      external: false,
    },
    {
      id: "bundled:///libs/lib.es2015.collection.d.ts#Map:interface",
      kind: "interface",
      name: "Map",
      file: "bundled:///libs/lib.es2015.collection.d.ts",
      external: true,
      evidence: { startLine: 19, startCol: 1, endLine: 19, endCol: 14 },
    },
  ],
  edges: [
    {
      from: "src/index.ts#src/index.ts:module",
      to: `src/core/order.ts#${name}:function`,
      kind: "exports",
      evidence: { startLine: 1, startCol: 1, endLine: 1, endCol: 10 },
    },
  ],
});

/** Every response owes the client these, whatever became of the request. */
const frame = (id, rest) => ({
  id,
  protocolVersion,
  capabilities: CAPABILITIES,
  ...rest,
});

const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  const request = JSON.parse(line);
  requests += 1;
  let response;
  if (invalidMode !== undefined) {
    const dump = graph("broken");
    if (invalidMode === "--invalid") {
      dump.edges[0].to = "src/core/order.ts#missing:function";
    } else if (invalidMode === "--invalid-span") {
      dump.nodes[1].evidence = {
        startLine: 3,
        startCol: 8,
        endLine: 3,
        endCol: 2,
      };
    } else if (invalidMode === "--invalid-path") {
      dump.nodes[1].evidence.file = "../escape.ts";
    } else if (invalidMode === "--invalid-node-evidence") {
      dump.nodes[1].evidence.file = "src/index.ts";
    } else if (invalidMode === "--invalid-edge-evidence") {
      dump.edges[0].evidence.file = "src/core/order.ts";
    } else if (invalidMode === "--invalid-bundled-workspace") {
      dump.nodes.at(-1).external = false;
    } else if (invalidMode === "--invalid-manifest") {
      // A file the facts name but the manifest never loaded: two programs'
      // output in one envelope.
      dump.provenance.sources = dump.provenance.sources.filter(
        (entry) => entry.file !== "src/core/order.ts",
      );
    } else if (invalidMode === "--invalid-manifest-digest") {
      dump.provenance.sources[0].checkerDigest = "not-a-sha256";
    } else if (invalidMode === "--invalid-manifest-duplicate") {
      dump.provenance.sources.push({ ...dump.provenance.sources[0] });
    } else if (invalidMode === "--invalid-diagnostic-file") {
      dump.diagnostics[0].file = "src/never-loaded.ts";
    } else if (invalidMode === "--invalid-diagnostic-category") {
      dump.diagnostics[0].category = "advice";
    } else if (invalidMode === "--invalid-universe-configs") {
      dump.provenance.universe.configs = [];
    } else if (invalidMode === "--invalid-universe-digest") {
      dump.provenance.universe.configs[0].digest = "0123";
    } else if (invalidMode === "--invalid-disk-digest") {
      dump.provenance.sources[0].diskDigest = "not-a-sha256";
    } else {
      throw new Error(`unknown invalid mode: ${invalidMode}`);
    }
    response = frame(request.id, { changed: true, mode: "initial", dump });
  } else if (requests === 1) {
    response = frame(request.id, {
      changed: true,
      mode: "initial",
      dump: graph("first"),
    });
  } else if (requests === 2) {
    response = frame(request.id, { changed: false, mode: "unchanged" });
  } else if (requests === 3) {
    response = frame(request.id, {
      changed: true,
      mode: "incremental",
      dump: graph("second", universeDrift ? { drift: "moved" } : {}),
    });
  } else {
    response = frame(request.id, {
      changed: false,
      mode: "error",
      error: "synthetic failure",
    });
  }
  process.stdout.write(`${JSON.stringify(response)}\n`);
});
input.on("close", () => {
  if (marker !== undefined) fs.writeFileSync(marker, "closed\n");
  // The count is the evidence that one refresh costs one request. The client
  // used to spend a second round-trip per changed snapshot asking whether the
  // first one still held, so this number would read 5 where it now reads 3.
  if (requestLog !== undefined) fs.writeFileSync(requestLog, `${requests}\n`);
});
