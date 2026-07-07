import { CORPUS } from "./corpus.mjs";

console.log(`Agent-cost A/B corpus (${CORPUS.length} repos, codegraph questions):\n`);
for (const entry of CORPUS) {
  console.log(`  ${entry.name.padEnd(12)} ${entry.language.padEnd(11)} ${entry.url}`);
  console.log(`  ${" ".repeat(24)}Q: ${entry.question}`);
}
