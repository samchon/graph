#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const options = new Map(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith("--"))
    .map((arg) => {
      const at = arg.indexOf("=");
      return at === -1
        ? [arg.slice(2), ""]
        : [arg.slice(2, at), arg.slice(at + 1)];
    }),
);

const output = options.get("output");
const input = options.get("input");
const mode = options.get("mode") ?? "copy";

if (mode === "fail") {
  process.stderr.write("fake-sidecar: refusing to analyze\n");
  process.exit(3);
}
if (mode === "silent") process.exit(0);

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.copyFileSync(input, output);
