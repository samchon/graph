// Cross-language benchmark corpus. The `dedicated` questions live in
// questions/<name>.md, taken verbatim from codegraph's evaluation suite
// (.claude/skills/agent-eval/corpus.json) and pinned by SHA-256 in
// questions/manifest.json (regenerate with src/generate-manifest.mjs). The
// shared `common` onboarding question (questions/common.md) is asked against
// every repo.
//
// Coverage standard is codegraph's own: every supported language that appears
// in its suite is here, one repo each — 14 of the 17 registered languages.
// scala, zig, and bash are deliberately absent: codegraph has no dedicated
// utterance for them, and inventing one would break prompt provenance.
//
// Each entry pins the exact `commit` measured (recorded 2026-07-08 from each
// repo's HEAD) so runs stay reproducible while upstreams move. `maxFiles` caps
// how many source files the graph indexes so a huge tree (flutter, redis)
// stays a bounded, comparable measurement.
export const CORPUS = [
  {
    // A fork of excalidraw/excalidraw with `ttsc` (and its native TS7
    // runtime, @typescript/typescript-win32-x64) pinned as devDependencies
    // (github.com/samchon/ttsc-benchmark-excalidraw) so ttscserver resolves
    // and runs from the repo's own node_modules instead of depending on a
    // global install — otherwise a fresh clone falls back to the static
    // indexer, or ttscserver crashes outright without the native binary.
    name: "excalidraw",
    language: "typescript",
    url: "https://github.com/samchon/ttsc-benchmark-excalidraw.git",
    commit: "98a2730b197873d43fddbe3fad6f0812df84b451",
    maxFiles: 2000,
    // The full-density pre-build walks documentSymbol across this 2000-file
    // monorepo; the default 10s per-request timeout isn't enough under
    // concurrent load.
    lspTimeoutMs: 60000,
    // ttscserver resolves references from the TypeScript checker's own
    // symbol table (not per-symbol textDocument/references round-trips), so
    // it stays fast even far past the default cap: the repo has ~4.7k
    // non-test symbols, and ttscserver covers all of them in single-digit
    // seconds. Capping at the 3000 default here would silently drop edges
    // for roughly a third of the codebase.
    lspReferenceLimit: 6000,
  },
  {
    name: "gin",
    language: "go",
    url: "https://github.com/gin-gonic/gin.git",
    commit: "34dac209ffb6ef85cc78c5d217bbb7ad001d68fd",
    maxFiles: 1500,
  },
  {
    name: "flask",
    language: "python",
    url: "https://github.com/pallets/flask.git",
    commit: "36e4a824f340fdee7ed50937ba8e7f6bc7d17f81",
    maxFiles: 1500,
  },
  {
    name: "tokio",
    language: "rust",
    url: "https://github.com/tokio-rs/tokio.git",
    commit: "c4c6265a0746a79d4a2f3852f726aa0101f29fd3",
    maxFiles: 2000,
    // rust-analyzer covers ~2.7k non-test symbols; the default 3000 cap
    // already fits, but give it headroom since the workspace's true symbol
    // count runs higher once rust-analyzer's own dependency indexing kicks in.
    lspReferenceLimit: 4000,
    // rust-analyzer's initial cross-crate index on a workspace this size can
    // still be running well past the library's own 180s default; without
    // enough headroom here, reference collection starts before indexing
    // finishes and every edge request comes back empty (confirmed: an
    // earlier run produced a graph with zero calls/type_ref/references
    // edges, only structural `contains` edges).
    lspReadyTimeoutMs: 300000,
  },
  {
    name: "gson",
    language: "java",
    url: "https://github.com/google/gson.git",
    commit: "c9f3fd55854a743b66f857ace3c7b268ea3e2ef7",
    maxFiles: 1500,
    // jdtls imports the workspace on a JVM before answering; give initialize
    // room (JAVA_HOME is pointed at the provisioned JDK 21 by lib.mjs).
    lspTimeoutMs: 90000,
  },
  {
    name: "redis",
    language: "c",
    url: "https://github.com/redis/redis.git",
    commit: "6bf6224c3dad518329ddc893ef9c5d58dcbabdeb",
    maxFiles: 2000,
    // clangd can take tens of seconds on redis's largest translation units;
    // give documentSymbol/references room so the graph does not fall back.
    lspTimeoutMs: 30000,
    // redis has ~21k non-test symbols -- far past what any cap here can fully
    // cover -- but even a partial increase over the 3000 default recovers a
    // meaningful share of the missing edges without materially slowing the
    // pre-build.
    lspReferenceLimit: 4000,
  },
  {
    // codegraph's cpp pick (nlohmann/json) is a single-header library — it
    // yields ~27 nodes / 0 edges, a degenerate graph target. Substitute
    // leveldb, a real multi-file C++ project, and note the deviation: the
    // question is repo-appropriate rather than codegraph-verbatim.
    name: "leveldb",
    language: "cpp",
    url: "https://github.com/google/leveldb.git",
    commit: "7ee830d02b623e8ffe0b95d59a74db1e58da04c5",
    maxFiles: 1500,
    // ~2.8k non-test symbols; raise past the default 3000 cap to cover them.
    lspReferenceLimit: 3500,
  },
  {
    name: "sinatra",
    language: "ruby",
    url: "https://github.com/sinatra/sinatra.git",
    commit: "5236d3459b8b9015e5ce21ddd0c6beb0db4081d4",
    maxFiles: 1500,
    // ruby-lsp composes a bundle from the project's Gemfile; install it into a
    // vendored path first, then give initialize room. ruby-lsp is also very slow
    // on textDocument/references (tens of seconds each), so give the warmup a
    // patient budget to land the reference index before the batch.
    prepare: "bundle config set --local path vendor/bundle && bundle install",
    lspTimeoutMs: 60000,
    lspWarmupTimeoutMs: 180000,
  },
  {
    name: "slim",
    language: "php",
    url: "https://github.com/slimphp/Slim.git",
    commit: "0da7dd2fc66956730b6633f6a056b35e59126583",
    maxFiles: 1500,
  },
  {
    name: "serilog",
    language: "csharp",
    url: "https://github.com/serilog/serilog.git",
    commit: "6d9fc0b84e004418f2677b5961b9c8970349d0be",
    maxFiles: 1500,
  },
  {
    name: "koin",
    language: "kotlin",
    url: "https://github.com/InsertKoinIO/koin.git",
    commit: "dc86ef8dd8fbe8564fb7453c03f5b738da3450bb",
    maxFiles: 1500,
    // kotlin-language-server boots a JVM and imports the build via a Gradle
    // sync (kotlinLSPProjectDeps) before answering `initialize` at all; cold,
    // this took over ten minutes on a clean Gradle cache. Give initialize
    // patient room, and the reference warmup too, matching sinatra's
    // ruby-lsp treatment. A warm Gradle cache makes repeat runs fast.
    lspTimeoutMs: 600000,
    lspWarmupTimeoutMs: 300000,
    // ~6k non-test symbols across koin's modules; raise past the default
    // 3000 cap. kotlin-language-server's own JVM warmup dominates the wall
    // time here regardless, so this adds little on top of it.
    lspReferenceLimit: 6000,
  },
  {
    name: "alamofire",
    language: "swift",
    url: "https://github.com/Alamofire/Alamofire.git",
    commit: "903c53c710d1cbbac0b4b9c2527aefb791e1fee3",
    maxFiles: 1500,
  },
  {
    name: "lualine",
    language: "lua",
    url: "https://github.com/nvim-lualine/lualine.nvim.git",
    commit: "221ce6b2d999187044529f49da6554a92f740a96",
    maxFiles: 1500,
  },
  {
    // flutter's 6.5k-file monorepo made the Dart analysis server emit a
    // pathological ~500MB reference graph; dart-lang/http is a real,
    // focused multi-package HTTP library that indexes cleanly (339 nodes /
    // 384 edges, 7MB).
    name: "darthttp",
    language: "dart",
    url: "https://github.com/dart-lang/http.git",
    commit: "5d94ef52582867e077bf41c3fa20fb8b1d1d834e",
    maxFiles: 300,
    lspTimeoutMs: 90000,
  },
];

export const findCorpus = (name) => {
  const found = CORPUS.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`Unknown benchmark repo: ${name}`);
  return found;
};
