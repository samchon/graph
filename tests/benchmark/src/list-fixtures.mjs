import { BENCHMARK_FIXTURES } from "./fixtures.mjs";

for (const fixture of BENCHMARK_FIXTURES) {
  console.log(`${fixture.name}\t${fixture.language}\t${fixture.repository}`);
}
