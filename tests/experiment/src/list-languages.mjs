import { LANGUAGE_EXPERIMENTS } from "./catalog.mjs";

for (const experiment of LANGUAGE_EXPERIMENTS) {
  console.log(`${experiment.language}\t${experiment.repository}`);
}
