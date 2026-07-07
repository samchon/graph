// Cross-language benchmark corpus. Repositories and their `dedicated` questions
// are taken verbatim from codegraph's evaluation suite
// (.claude/skills/agent-eval/corpus.json), so the agent-cost A/B mirrors the
// benchmark @ttsc/graph and codegraph publish — generalized across the languages
// @samchon/graph indexes rather than TypeScript alone. The shared `common`
// onboarding question (questions/common.md) is asked against every repo.
//
// Each entry: a shallow-clonable repo, its primary language, and the exact
// codegraph question. `maxFiles` caps how many source files the graph indexes
// so a huge tree (flutter, redis) stays a bounded, comparable measurement.
export const CORPUS = [
  {
    name: "excalidraw",
    language: "typescript",
    url: "https://github.com/excalidraw/excalidraw.git",
    question: "How does Excalidraw render and update canvas elements?",
    maxFiles: 400,
  },
  {
    name: "express",
    language: "javascript",
    url: "https://github.com/expressjs/express.git",
    question: "How does Express route a request through its middleware stack?",
    maxFiles: 300,
  },
  {
    name: "gin",
    language: "go",
    url: "https://github.com/gin-gonic/gin.git",
    question: "How does gin route requests through its middleware chain?",
    maxFiles: 300,
  },
  {
    name: "flask",
    language: "python",
    url: "https://github.com/pallets/flask.git",
    question: "How does Flask dispatch a request to a view function?",
    maxFiles: 300,
  },
  {
    name: "tokio",
    language: "rust",
    url: "https://github.com/tokio-rs/tokio.git",
    question: "How does tokio schedule and run async tasks on its runtime?",
    maxFiles: 400,
  },
  {
    name: "gson",
    language: "java",
    url: "https://github.com/google/gson.git",
    question: "How does Gson serialize an object to JSON?",
    maxFiles: 300,
  },
  {
    name: "redis",
    language: "c",
    url: "https://github.com/redis/redis.git",
    question: "How does Redis parse and dispatch a client command?",
    maxFiles: 400,
  },
  {
    name: "json",
    language: "cpp",
    url: "https://github.com/nlohmann/json.git",
    question: "How does nlohmann::json parse a JSON string into a value?",
    maxFiles: 300,
  },
  {
    name: "sinatra",
    language: "ruby",
    url: "https://github.com/sinatra/sinatra.git",
    question: "How does Sinatra match a request to a route handler?",
    maxFiles: 300,
  },
  {
    name: "slim",
    language: "php",
    url: "https://github.com/slimphp/Slim.git",
    question: "How does Slim handle a request through its middleware?",
    maxFiles: 300,
  },
  {
    name: "serilog",
    language: "csharp",
    url: "https://github.com/serilog/serilog.git",
    question: "How does Serilog route a log event to its sinks?",
    maxFiles: 300,
  },
  {
    name: "koin",
    language: "kotlin",
    url: "https://github.com/InsertKoinIO/koin.git",
    question: "How does Koin resolve and inject dependencies?",
    maxFiles: 300,
  },
  {
    name: "alamofire",
    language: "swift",
    url: "https://github.com/Alamofire/Alamofire.git",
    question: "How does Alamofire build, send, and validate a request?",
    maxFiles: 300,
  },
];

export const findCorpus = (name) => {
  const found = CORPUS.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`Unknown benchmark repo: ${name}`);
  return found;
};
