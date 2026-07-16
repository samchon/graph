const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");

const args = process.argv.slice(2);
const cwdIndex = args.indexOf("--cwd");
const project = cwdIndex === -1 ? process.cwd() : path.resolve(args[cwdIndex + 1]);
const invalidMode = args.find((arg) => arg.startsWith("--invalid"));
const markerArg = args.find((arg) => arg.startsWith("--marker="));
const marker = markerArg?.slice("--marker=".length);
let requests = 0;

const graph = (name) => ({
  project,
  tsconfig: "tsconfig.json",
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
    } else {
      throw new Error(`unknown invalid mode: ${invalidMode}`);
    }
    response = { id: request.id, changed: true, mode: "initial", dump };
  } else if (requests === 1) {
    response = { id: request.id, changed: true, mode: "initial", dump: graph("first") };
  } else if (requests === 2 || requests === 3) {
    response = { id: request.id, changed: false, mode: "unchanged" };
  } else if (requests === 4) {
    response = { id: request.id, changed: true, mode: "incremental", dump: graph("second") };
  } else if (requests === 5) {
    response = { id: request.id, changed: false, mode: "unchanged" };
  } else {
    response = { id: request.id, changed: false, error: "synthetic failure" };
  }
  process.stdout.write(`${JSON.stringify(response)}\n`);
});
input.on("close", () => {
  if (marker !== undefined) fs.writeFileSync(marker, "closed\n");
});
