#!/usr/bin/env node
// Regenerate questions/manifest.json from the prompt files on disk. The
// manifest pins the prompt text and the exact multi-language fixture commit.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CORPUS } from "./corpus.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const qDir = path.join(here, "questions");
const has = (rel) => fs.existsSync(path.join(qDir, rel));
const sha = (rel) =>
  crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(qDir, rel)).toString().replace(/\r\n/g, "\n").trim())
    .digest("hex");

const prompt = (repo, family, file, spec) => ({
  id: `${repo}-${family}-v1`,
  repo,
  family,
  file,
  fixtureCommit: spec.commit,
  language: spec.language,
  questionSha256: sha(file),
});

const prompts = [];
for (const spec of CORPUS) {
  const dedicated = `${spec.name}.md`;
  if (has(dedicated))
    prompts.push(prompt(spec.name, "dedicated", dedicated, spec));
  else console.warn(`warning: ${spec.name} has no ${dedicated}; skipped`);
  prompts.push(prompt(spec.name, "common", "common.md", spec));
}

const manifest = { schemaVersion: 1, prompts };
fs.writeFileSync(
  path.join(qDir, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(`manifest.json: ${prompts.length} prompts`);
for (const item of prompts)
  console.log(
    `  ${item.id.padEnd(34)} ${item.family.padEnd(10)} ${item.file}`,
  );
