#!/usr/bin/env node
"use strict";

/**
 * The pinned helper that turns a binary SCIP index into JSON.
 *
 * The fake indexer writes JSON directly, so this only has to read it back and
 * put it on stdout — which is exactly the shape of the real `scip print --json`
 * contract the session depends on, including the part where a decode failure
 * must leave the previous generation standing.
 */
const fs = require("node:fs");

const args = process.argv.slice(2);
const mode = args.find((arg) => arg.startsWith("--mode="))?.slice("--mode=".length);
const artifact = args[args.length - 1];

if (mode === "fail") {
  process.stderr.write("fake-scip: cannot decode\n");
  process.exit(4);
}

process.stdout.write(
  mode === "garbage" ? "{ not json" : fs.readFileSync(artifact, "utf8"),
);
