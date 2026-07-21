#!/usr/bin/env node
"use strict";

/**
 * A SCIP indexer that does exactly what it is told, so a session's lifecycle
 * can be proved without installing one.
 *
 * A real indexer's contract with the session is narrow: read the project, write
 * one artifact where it was told to, and exit. Everything the session must
 * handle around that — an artifact that never appears, a non-zero exit, a
 * process that ignores its first signal — is a mode here rather than a mock,
 * because a stubbed session would prove the test's own arrangement rather than
 * the shutdown and validation paths that exist for these cases.
 */
const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);
const options = new Map(
  args
    .filter((arg) => arg.startsWith("--"))
    .map((arg) => {
      const at = arg.indexOf("=");
      return at === -1
        ? [arg.slice(2), ""]
        : [arg.slice(2, at), arg.slice(at + 1)];
    }),
);

const output = options.get("output");
const mode = options.get("mode") ?? "index";
const state = options.get("state");

// A generation counter on disk, so one fixture can answer the first call
// differently from the second without the test having to swap binaries.
const generation = (() => {
  if (state === undefined) return 0;
  const previous = fs.existsSync(state)
    ? Number(fs.readFileSync(state, "utf8").trim())
    : 0;
  fs.writeFileSync(state, String(previous + 1));
  return previous;
})();

if (mode === "fail") {
  process.stderr.write("fake-scip: refusing to index\n");
  process.exit(3);
}

if (mode === "silent") {
  // Exits cleanly having written nothing. The session must notice the missing
  // artifact rather than decoding whatever was there before.
  process.exit(0);
}

if (mode === "hang") {
  // Ignores the first termination signal, so close() has to escalate.
  process.on("SIGTERM", () => {});
  setInterval(() => {}, 1_000);
} else {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(indexOf(generation)));
  process.exit(0);
}

function indexOf(generation) {
  const root = options.get("root") ?? "/";
  const name = generation === 0 ? "first" : "second";
  const symbol = `scip-fake fake example v1 \`pkg\`/${name}().`;
  const relativePath = options.get("document") ?? "main.go";
  // Most indexers omit `text`. The ones that carry it are the only ones whose
  // facts can be tied to the bytes they were computed from, so both shapes are
  // producible here.
  const withText = options.has("with-text");
  // Both shapes are real: the SCIP CLI writes a `file://` URI, while some
  // indexers put a plain absolute path there. And `toolInfo` is optional, so a
  // snapshot has to name the provider itself when the index does not.
  const plainRoot = options.has("plain-root");
  const bare = options.has("no-tool-info");
  return {
    metadata: {
      projectRoot: plainRoot
        ? root
        : `file://${root.startsWith("/") ? "" : "/"}${root.replace(/\\/g, "/")}`,
      ...(bare ? {} : { toolInfo: { name: "fake-scip", version: "1.2.3" } }),
    },
    documents: [
      {
        language: "Go",
        relativePath,
        ...(withText
          ? { text: fs.readFileSync(path.join(root, relativePath), "utf8") }
          : {}),
        symbols: [{ symbol, displayName: name, kind: "Function" }],
        occurrences: [{ range: [0, 5, 10], symbol, symbolRoles: 1 }],
      },
    ],
  };
}
