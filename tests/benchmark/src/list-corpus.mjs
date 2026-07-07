import fs from "node:fs";
import path from "node:path";

import { CORPUS } from "./corpus.mjs";
import { questionsDir, resolvePrompt } from "./lib.mjs";

console.log(`Agent-cost A/B corpus (${CORPUS.length} repos, codegraph questions, SHA-pinned):\n`);
const common = fs.readFileSync(path.join(questionsDir, "common.md"), "utf8").trim();
console.log(`  common (all repos): ${common.split("\n")[0]} ...\n`);
for (const entry of CORPUS) {
  const prompt = resolvePrompt({ family: "dedicated", repo: entry.name });
  console.log(`  ${entry.name.padEnd(12)} ${entry.language.padEnd(11)} ${entry.url} @ ${entry.commit.slice(0, 12)}`);
  console.log(`  ${" ".repeat(24)}Q: ${prompt.text}`);
}
