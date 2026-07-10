// `minEdges` gates the relationship edges an experiment must produce. It is set
// to 1 for languages whose reference edges are empirically confirmed against a
// real server (see the LSP experiment CI matrix) so a regression back to the
// "symbols but no edges" failure is caught. Languages still awaiting a first
// real-server measurement keep 0; the runner always records the observed count,
// so the CI artifact reports the true number and the gate can be tightened once
// a language is confirmed.
export const LANGUAGE_EXPERIMENTS = [
  {
    language: "typescript",
    repository: "https://github.com/nestjs/typescript-starter.git",
    maxFiles: 120,
    minNodes: 1,
    minEdges: 1,
  },
  {
    language: "go",
    repository: "https://github.com/gorilla/mux.git",
    maxFiles: 120,
    minNodes: 1,
    minEdges: 1,
  },
  {
    language: "rust",
    repository: "https://github.com/tokio-rs/mini-redis.git",
    maxFiles: 120,
    minNodes: 1,
    minEdges: 1,
  },
  {
    language: "cpp",
    repository: "https://github.com/fmtlib/fmt.git",
    maxFiles: 120,
    minNodes: 1,
    minEdges: 1,
    // fmt has a CMakeLists.txt, so clangd now gets a real compile_commands.json
    // (ensureCompileCommands) instead of guessed flags — real parsing is
    // slower than the fallback, and the default 10s request timeout isn't
    // enough for the first documentSymbol call on a cold clangd start.
    timeoutMs: 30000,
  },
  {
    language: "c",
    repository: "https://github.com/libuv/libuv.git",
    maxFiles: 120,
    minNodes: 1,
    minEdges: 1,
  },
  {
    language: "java",
    repository: "https://github.com/google/gson.git",
    maxFiles: 120,
    minNodes: 1,
    minEdges: 0,
    timeoutMs: 60000,
  },
  {
    // serilog has a root .sln, which csharp-ls needs to load a project context;
    // the dotnet/samples monorepo has none and yields zero symbols.
    language: "csharp",
    repository: "https://github.com/serilog/serilog.git",
    maxFiles: 120,
    minNodes: 1,
    minEdges: 0,
    timeoutMs: 60000,
    // csharp-ls loads the solution; restored packages make that load succeed.
    // Drop the fixture's global.json SDK pin (exact-band 10.0.100) so restore
    // runs on the installed SDK.
    prepare: "rm -f global.json && dotnet restore",
  },
  {
    language: "kotlin",
    repository: "https://github.com/Kotlin/kotlin-koans.git",
    maxFiles: 120,
    minNodes: 1,
    minEdges: 1,
    // kotlin-language-server is JVM-based like jdtls; a cold JVM start under
    // CI load can occasionally exceed the default 10s `initialize` timeout.
    timeoutMs: 60000,
  },
  {
    language: "swift",
    repository: "https://github.com/apple/swift-argument-parser.git",
    maxFiles: 120,
    minNodes: 1,
    minEdges: 1,
  },
  {
    language: "scala",
    repository: "https://github.com/scala/scala3-example-project.git",
    maxFiles: 120,
    minNodes: 1,
    minEdges: 1,
  },
  {
    language: "zig",
    repository: "https://github.com/Hejsil/zig-clap.git",
    maxFiles: 120,
    minNodes: 1,
    minEdges: 0,
  },
  {
    language: "python",
    repository: "https://github.com/pallets/click.git",
    maxFiles: 120,
    minNodes: 1,
    minEdges: 0,
  },
  {
    language: "ruby",
    repository: "https://github.com/sinatra/sinatra.git",
    maxFiles: 120,
    minNodes: 1,
    minEdges: 0,
    // ruby-lsp composes a bundle from the project's Gemfile; the dependencies
    // must be installed or the server exits at launch. Vendor the bundle —
    // an unprivileged install into the system gem path is denied. First boot
    // composes another bundle, which exceeds the default request timeout.
    prepare: "bundle config set --local path vendor/bundle && bundle install",
    timeoutMs: 60000,
  },
  {
    language: "php",
    repository: "https://github.com/slimphp/Slim.git",
    maxFiles: 120,
    minNodes: 1,
    minEdges: 0,
  },
  {
    language: "lua",
    repository: "https://github.com/nvim-lualine/lualine.nvim.git",
    maxFiles: 120,
    minNodes: 1,
    minEdges: 0,
  },
  {
    language: "bash",
    repository: "https://github.com/ohmybash/oh-my-bash.git",
    maxFiles: 120,
    minNodes: 1,
    minEdges: 0,
  },
  {
    language: "dart",
    repository: "https://github.com/dart-lang/http.git",
    maxFiles: 120,
    minNodes: 1,
    minEdges: 0,
  },
];

export const findExperiment = (language) => {
  const found = LANGUAGE_EXPERIMENTS.find((experiment) => experiment.language === language);
  if (found === undefined) throw new Error(`Unknown experiment language: ${language}`);
  return found;
};
