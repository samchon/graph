const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");

const args = process.argv.slice(2);
const cwdIndex = args.indexOf("--cwd");
const project = cwdIndex === -1 ? process.cwd() : path.resolve(args[cwdIndex + 1]);
const invalidMode = args.find((arg) => arg.startsWith("--invalid"));
const markerArg = args.find((arg) => arg.startsWith("--marker="));
const marker = markerArg?.slice("--marker=".length);
const serveArg = args.find((arg) => arg.startsWith("--serve="));
const serveCase = serveArg?.slice("--serve=".length);
let requests = 0;

// A resident serve process may emit diagnostics on stderr; the client must
// surface them verbatim when the process then dies.
if (serveCase === "stderr-exit") process.stderr.write("ttscgraph diagnostic: fatal\n");
// A process that keeps running after its stdin closes forces the client's
// graceful-close timeout, then its owned-process kill.
if (serveCase === "ignore-stdin") setInterval(() => {}, 1_000_000);

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

// Emit one deterministic protocol fault (or a well-formed but chunked/blank
// stream) so the client's NDJSON framing, response validation, and lifecycle
// error paths can each be asserted as a product invariant.
const respondServe = (request) => {
  const id = request.id;
  const send = (object) => process.stdout.write(`${JSON.stringify(object)}\n`);
  const raw = (text) => process.stdout.write(text);
  const changedFirst = { id, changed: true, mode: "initial", dump: graph("first") };
  const unchanged = { id, changed: false, mode: "unchanged" };
  switch (serveCase) {
    case "stderr-exit":
      process.exit(1);
      return;
    case "exit-silently":
      process.exit(1);
      return;
    case "ignore-stdin":
      send(requests === 1 ? changedFirst : unchanged);
      return;
    case "unchanged-first":
      send(unchanged);
      return;
    case "changed-no-dump":
      send({ id, changed: true, mode: "initial" });
      return;
    case "unchanged-with-dump":
      send({ id, changed: false, mode: "unchanged", dump: graph("first") });
      return;
    case "confirm-changed":
      send(
        requests === 1
          ? changedFirst
          : requests === 2
            ? { id, changed: true, mode: "incremental", dump: graph("second") }
            : unchanged,
      );
      return;
    case "confirm-error":
      send(requests === 1 ? changedFirst : { id, changed: false, error: "confirmation failed" });
      return;
    case "changed-not-boolean":
      send({ id, changed: "yes", mode: "initial" });
      return;
    case "error-not-string":
      send({ id, changed: false, error: 123 });
      return;
    case "mode-not-string":
      send({ id, changed: false, mode: 7 });
      return;
    case "invalid-json":
      raw("this is not valid json\n");
      return;
    case "non-object":
      raw("[1, 2, 3]\n");
      return;
    case "missing-id":
      raw(`${JSON.stringify({ changed: true, mode: "initial" })}\n`);
      return;
    case "unknown-id":
      raw(`${JSON.stringify({ id: id + 1000, changed: true, mode: "initial" })}\n`);
      return;
    case "blank-line":
      if (requests === 1) raw(`\n${JSON.stringify(changedFirst)}\n`);
      else send(unchanged);
      return;
    case "split-frame":
      if (requests === 1) {
        const full = JSON.stringify(changedFirst);
        const mid = Math.floor(full.length / 2);
        raw(full.slice(0, mid));
        // A later stream chunk completes the line, exercising reassembly.
        setTimeout(() => raw(`${full.slice(mid)}\n`), 20);
      } else send(unchanged);
      return;
    default:
      throw new Error(`unknown serve case: ${serveCase}`);
  }
};

const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  const request = JSON.parse(line);
  requests += 1;
  if (serveCase !== undefined) {
    respondServe(request);
    return;
  }
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
