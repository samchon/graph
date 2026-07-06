export const BENCHMARK_FIXTURES = [
  {
    name: "typeorm",
    repository: "https://github.com/typeorm/typeorm.git",
    language: "typescript",
    maxFiles: 300,
  },
  {
    name: "nestjs",
    repository: "https://github.com/nestjs/nest.git",
    language: "typescript",
    maxFiles: 300,
  },
  {
    name: "zod",
    repository: "https://github.com/colinhacks/zod.git",
    language: "typescript",
    maxFiles: 300,
  },
  {
    name: "vue",
    repository: "https://github.com/vuejs/core.git",
    language: "typescript",
    maxFiles: 300,
  },
];

export const findBenchmarkFixture = (name) => {
  const found = BENCHMARK_FIXTURES.find((fixture) => fixture.name === name);
  if (found === undefined) throw new Error(`Unknown benchmark fixture: ${name}`);
  return found;
};
