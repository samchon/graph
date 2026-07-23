#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);
const producerArgument = args.find((arg) => arg.startsWith("--producer="));
if (producerArgument === undefined) {
  throw new Error("fake standard provider: --producer is required");
}
const producer = producerArgument.slice("--producer=".length);
const forwarded = args.filter((arg) => arg !== producerArgument);

if (forwarded.includes("--version")) {
  process.stdout.write(`${producer} v1.0.0\n`);
  process.exit(0);
}

if (producer === "scip") {
  const artifact = forwarded[forwarded.length - 1];
  if (artifact === undefined) {
    throw new Error("fake standard provider: SCIP artifact is required");
  }
  process.stdout.write(fs.readFileSync(artifact, "utf8"));
  process.exit(0);
}

const descriptions = {
  "scip-clang": { language: "C++", file: "src/main.cpp" },
  "scip-java": { language: "Java", file: "src/Main.java" },
  "scip-dotnet": { language: "C#", file: "src/Main.cs" },
  "scip-python": { language: "Python", file: "src/main.py" },
  "scip-ruby": { language: "Ruby", file: "src/main.rb" },
};
const scip = descriptions[producer];
if (scip !== undefined) {
  const output =
    valueOf(forwarded, "--index-output-path=") ??
    valueAfter(forwarded, "--output") ??
    valueAfter(forwarded, "--index-file");
  if (output === undefined) {
    throw new Error(`fake standard provider: ${producer} output is required`);
  }
  const text = fs.readFileSync(path.join(process.cwd(), scip.file), "utf8");
  const symbol = `scip-fake fake example v1 \`pkg\`/main().`;
  write(output, {
    metadata: {
      projectRoot: fileUri(process.cwd()),
      toolInfo: { name: producer, version: "1.0.0" },
    },
    documents: [
      {
        language: scip.language,
        relativePath: scip.file,
        text,
        symbols: [{ symbol, displayName: "main", kind: "Function" }],
        occurrences: [{ range: [0, 0, 1], symbol, symbolRoles: 1 }],
      },
    ],
  });
  process.exit(0);
}

const sidecarLanguages = new Set(["swift", "zig", "php", "lua", "dart"]);
const sidecarLanguage = producer.startsWith("samchon-graph-")
  ? producer.slice("samchon-graph-".length)
  : producer;
if (sidecarLanguages.has(sidecarLanguage)) {
  const output = valueOf(forwarded, "--output=");
  if (output === undefined) {
    throw new Error(`fake standard provider: ${producer} output is required`);
  }
  const files = {
    swift: "src/Main.swift",
    zig: "src/main.zig",
    php: "src/main.php",
    lua: "src/main.lua",
    dart: "src/main.dart",
  };
  const file = files[sidecarLanguage];
  const text = fs.readFileSync(path.join(process.cwd(), file), "utf8");
  const digest = sha256(text);
  write(output, {
    schemaVersion: 1,
    projectRoot: fileUri(process.cwd()),
    languages: [sidecarLanguage],
    tool: {
      name: `samchon-graph-${sidecarLanguage}`,
      version: "1.0.0",
      compilerVersion: `${sidecarLanguage}-fixture`,
      protocolVersion: 1,
    },
    universe: sha256(`${sidecarLanguage}-universe`),
    capabilities: ["sourceDigests", "diskDigests"],
    sources: [
      {
        file,
        checkerDigest: digest,
        diskDigest: digest,
      },
    ],
    nodes: [],
    edges: [],
    diagnostics: [],
    warnings: [],
  });
  process.exit(0);
}

throw new Error(`fake standard provider: unknown producer ${producer}`);

function valueOf(values, prefix) {
  return values.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function valueAfter(values, flag) {
  const index = values.indexOf(flag);
  return index === -1 ? undefined : values[index + 1];
}

function fileUri(file) {
  return `file://${file.startsWith("/") ? "" : "/"}${file.replace(/\\/g, "/")}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}
