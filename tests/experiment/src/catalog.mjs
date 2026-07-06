export const LANGUAGE_EXPERIMENTS = [
  {
    language: "typescript",
    repository: "https://github.com/nestjs/typescript-starter.git",
    maxFiles: 120,
    minNodes: 1,
  },
  {
    language: "javascript",
    repository: "https://github.com/expressjs/express.git",
    maxFiles: 120,
    minNodes: 1,
  },
  {
    language: "go",
    repository: "https://github.com/gorilla/mux.git",
    maxFiles: 120,
    minNodes: 1,
  },
  {
    language: "rust",
    repository: "https://github.com/tokio-rs/mini-redis.git",
    maxFiles: 120,
    minNodes: 1,
  },
  {
    language: "cpp",
    repository: "https://github.com/fmtlib/fmt.git",
    maxFiles: 120,
    minNodes: 1,
  },
  {
    language: "c",
    repository: "https://github.com/libuv/libuv.git",
    maxFiles: 120,
    minNodes: 1,
  },
  {
    language: "java",
    repository: "https://github.com/google/gson.git",
    maxFiles: 120,
    minNodes: 1,
  },
  {
    language: "csharp",
    repository: "https://github.com/dotnet/samples.git",
    maxFiles: 120,
    minNodes: 1,
  },
  {
    language: "kotlin",
    repository: "https://github.com/Kotlin/kotlin-koans.git",
    maxFiles: 120,
    minNodes: 1,
  },
  {
    language: "swift",
    repository: "https://github.com/apple/swift-argument-parser.git",
    maxFiles: 120,
    minNodes: 1,
  },
  {
    language: "scala",
    repository: "https://github.com/scala/scala3-example-project.git",
    maxFiles: 120,
    minNodes: 1,
  },
  {
    language: "zig",
    repository: "https://github.com/ratfactor/ziglings.git",
    maxFiles: 120,
    minNodes: 1,
  },
];

export const findExperiment = (language) => {
  const found = LANGUAGE_EXPERIMENTS.find((experiment) => experiment.language === language);
  if (found === undefined) throw new Error(`Unknown experiment language: ${language}`);
  return found;
};
