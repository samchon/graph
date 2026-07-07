// Regenerates questions/manifest.json from the question files on disk. The
// manifest pins each benchmark prompt by SHA-256 so a run can prove exactly
// which utterance it measured; agent-ab.mjs refuses to run when a file no
// longer matches its pinned hash.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CORPUS } from "./corpus.mjs";

const questionsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "questions");

const sha256 = (text) => crypto.createHash("sha256").update(text, "utf8").digest("hex");
const entryOf = (id, family, file, repo) => {
  const text = fs.readFileSync(path.join(questionsDir, file), "utf8").trim();
  return { id, family, ...(repo ? { repo } : {}), file, questionSha256: sha256(text) };
};

const prompts = [entryOf("common-v1", "common", "common.md")];
for (const entry of CORPUS) {
  prompts.push(entryOf(`${entry.name}-dedicated-v1`, "dedicated", `${entry.name}.md`, entry.name));
}

const manifestPath = path.join(questionsDir, "manifest.json");
fs.writeFileSync(manifestPath, `${JSON.stringify({ prompts }, null, 2)}\n`);
console.log(`Wrote ${manifestPath} (${prompts.length} prompts)`);
