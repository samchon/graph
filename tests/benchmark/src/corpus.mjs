// Cross-language benchmark corpus. The `dedicated` questions live in
// questions/<name>.md, taken verbatim from codegraph's evaluation suite
// (.claude/skills/agent-eval/corpus.json) and pinned by SHA-256 in
// questions/manifest.json (regenerate with src/generate-manifest.mjs). The
// shared `common` onboarding question (questions/common.md) is asked against
// every repo.
//
// Coverage standard is codegraph's own: every supported language that appears
// in its suite is here, one repo each — 15 of the 18 registered languages.
// scala, zig, and bash are deliberately absent: codegraph has no dedicated
// utterance for them, and inventing one would break prompt provenance.
//
// Each entry pins the exact `commit` measured (recorded 2026-07-08 from each
// repo's HEAD) so runs stay reproducible while upstreams move. `maxFiles` caps
// how many source files the graph indexes so a huge tree (flutter, redis)
// stays a bounded, comparable measurement.
export const CORPUS = [
  {
    name: "excalidraw",
    language: "typescript",
    url: "https://github.com/excalidraw/excalidraw.git",
    commit: "dd8296af1802d4920a645591e0de88b9272745fa",
    maxFiles: 400,
  },
  {
    name: "express",
    language: "javascript",
    url: "https://github.com/expressjs/express.git",
    commit: "ba006766fb964571723138708eacaba0f55759cd",
    maxFiles: 300,
  },
  {
    name: "gin",
    language: "go",
    url: "https://github.com/gin-gonic/gin.git",
    commit: "34dac209ffb6ef85cc78c5d217bbb7ad001d68fd",
    maxFiles: 300,
  },
  {
    name: "flask",
    language: "python",
    url: "https://github.com/pallets/flask.git",
    commit: "36e4a824f340fdee7ed50937ba8e7f6bc7d17f81",
    maxFiles: 300,
  },
  {
    name: "tokio",
    language: "rust",
    url: "https://github.com/tokio-rs/tokio.git",
    commit: "c4c6265a0746a79d4a2f3852f726aa0101f29fd3",
    maxFiles: 400,
  },
  {
    name: "gson",
    language: "java",
    url: "https://github.com/google/gson.git",
    commit: "c9f3fd55854a743b66f857ace3c7b268ea3e2ef7",
    maxFiles: 300,
  },
  {
    name: "redis",
    language: "c",
    url: "https://github.com/redis/redis.git",
    commit: "6bf6224c3dad518329ddc893ef9c5d58dcbabdeb",
    maxFiles: 400,
  },
  {
    name: "json",
    language: "cpp",
    url: "https://github.com/nlohmann/json.git",
    commit: "acf076a677c161643e64d8f83fd02624fd8c4bd3",
    maxFiles: 300,
  },
  {
    name: "sinatra",
    language: "ruby",
    url: "https://github.com/sinatra/sinatra.git",
    commit: "5236d3459b8b9015e5ce21ddd0c6beb0db4081d4",
    maxFiles: 300,
  },
  {
    name: "slim",
    language: "php",
    url: "https://github.com/slimphp/Slim.git",
    commit: "0da7dd2fc66956730b6633f6a056b35e59126583",
    maxFiles: 300,
  },
  {
    name: "serilog",
    language: "csharp",
    url: "https://github.com/serilog/serilog.git",
    commit: "6d9fc0b84e004418f2677b5961b9c8970349d0be",
    maxFiles: 300,
  },
  {
    name: "koin",
    language: "kotlin",
    url: "https://github.com/InsertKoinIO/koin.git",
    commit: "dc86ef8dd8fbe8564fb7453c03f5b738da3450bb",
    maxFiles: 300,
  },
  {
    name: "alamofire",
    language: "swift",
    url: "https://github.com/Alamofire/Alamofire.git",
    commit: "903c53c710d1cbbac0b4b9c2527aefb791e1fee3",
    maxFiles: 300,
  },
  {
    name: "lualine",
    language: "lua",
    url: "https://github.com/nvim-lualine/lualine.nvim.git",
    commit: "221ce6b2d999187044529f49da6554a92f740a96",
    maxFiles: 300,
  },
  {
    name: "flutter",
    language: "dart",
    url: "https://github.com/flutter/flutter.git",
    commit: "23815692ac0dfd036fed2f58ccc9f947bc7df9c3",
    maxFiles: 400,
    // The Dart analysis server scans the package before answering; the default
    // 10s per-request timeout is not enough on a tree this size.
    lspTimeoutMs: 60000,
  },
];

export const findCorpus = (name) => {
  const found = CORPUS.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`Unknown benchmark repo: ${name}`);
  return found;
};
