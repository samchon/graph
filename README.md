# `@samchon/graph`

![Logo](https://raw.githubusercontent.com/samchon/graph/master/assets/og.jpg)

[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/samchon/graph/blob/master/LICENSE) [![NPM Version](https://img.shields.io/npm/v/@samchon/graph.svg)](https://www.npmjs.com/package/@samchon/graph) [![NPM Downloads](https://img.shields.io/npm/dm/@samchon/graph.svg)](https://www.npmjs.com/package/@samchon/graph) [![Build Status](https://github.com/samchon/graph/workflows/test/badge.svg)](https://github.com/samchon/graph/actions?query=workflow%3Atest)

`@samchon/graph` is an MCP server that gives AI agents a code graph instead of source files.

It indexes a codebase in 17 languages into a graph of declarations and their relationships, and answers an agent's code questions from that index through a single tool. Semantic edges come from each language's language server when one is installed; otherwise a built-in static parser takes over.

Coding agents normally answer a code question by grepping the repository and reading file after file into context, and that reading is most of the token bill. The graph removes the need for it, and its own answers stay small in turn: they carry names, signatures, relationships, and source spans, never file bodies.

Since neither side of that exchange grows with the repository, the cost falls by about the same proportion in every situation, on every codebase — for an agent that trusts the graph result enough to stop there. codex/gpt-5.4-mini does; see the [Benchmark](#benchmark) section below for a harness where a model doesn't, and reads on top of the graph call anyway. That even distribution is what separates this from [`codegraph`](https://github.com/colbymchenry/codegraph) and [`serena`](https://github.com/oraios/serena) when it holds, and it shows directly in the chart below:

![Agent token cost — onboarding, per repository](https://raw.githubusercontent.com/samchon/graph/master/assets/benchmark-codex-gpt-5.4-mini-common.svg)

## Setup

### MCP server

```bash
npm install -D @samchon/graph
```

```json
{
  "mcpServers": {
    "samchon-graph": {
      "command": "npx",
      "args": ["-y", "@samchon/graph"]
    }
  }
}
```

Start the client from the project root. The server builds one resident graph and answers every MCP call from memory. If no language server is installed, a built-in static indexer parses the source directly; every language indexes in about 1–2 seconds, even on large repositories.

### Language Server

A language server improves the graph with semantically resolved edges. Install the ones for your stack; nothing is provided automatically, and an installed editor such as VS Code does not expose a stdio language server:

| Language | Server | Install |
|---|---|---|
| TypeScript | `ttscserver` (0.18+) | `npm i -D ttsc typescript` |
| Python | `pyright-langserver` | `npm i -D pyright` |
| Go | `gopls` | `go install golang.org/x/tools/gopls@latest` |
| Rust | `rust-analyzer` | `rustup component add rust-analyzer` |
| C / C++ | `clangd` | LLVM release, or your package manager |
| Java | `jdtls` | Eclipse JDT LS (needs JDK 21+) |
| C# | `csharp-ls` | `dotnet tool install -g csharp-ls` |
| Kotlin | `kotlin-language-server` | fwcd/kotlin-language-server |
| Swift | `sourcekit-lsp` | ships with the Swift toolchain |
| Scala | `metals` | `cs install metals` |
| Zig | `zls` | zigtools/zls |
| Ruby | `ruby-lsp` | `gem install ruby-lsp` |
| PHP | `intelephense` | `npm i -D intelephense` |
| Lua | `lua-language-server` | LuaLS/lua-language-server |
| Dart | `dart` | ships with the Dart SDK |
| Bash | `bash-language-server` | `npm i -D bash-language-server` |

Each server must be on `PATH`. If none is present for a file's language, that language falls back to the static indexer automatically.

JavaScript is intentionally not indexed. In an arbitrary repository, `.js`/`.jsx`/`.mjs`/`.cjs` files are as often build output or vendored bundles as handwritten source, and the graph cannot tell which without project-specific provenance.

## Benchmark

Each repository is measured with one headless agent run per arm (`baseline` with no MCP, `@samchon/graph`, `codegraph`, `serena`) on two prompt families, across two agent CLIs (`codex` and Claude Code). The corpus pins 14 repositories, one per language.

### Onboarding

Every repository is asked the same onboarding question, with no tool guidance appended:

> I'm new to this codebase and need a real code-based tour before my first behavior change.
>
> Find the central runtime flow, trace it from the public API to the code that does the work, and show the nearby code paths and tests I should read next.

<details>
<summary><code>codex</code> · <code>gpt-5.4-mini</code> — median token reduction 96% (codegraph 66%, serena 11%)</summary>

![Agent token cost — onboarding, per repository](https://raw.githubusercontent.com/samchon/graph/master/assets/benchmark-codex-gpt-5.4-mini-common.svg)

</details>

### Dedicated

`codegraph`'s own per-repository questions, verbatim:

| Project | Language | Prompt |
|---|---|---|
| [excalidraw](https://github.com/excalidraw/excalidraw) | TypeScript | How does Excalidraw render and update canvas elements? |
| [gin](https://github.com/gin-gonic/gin) | Go | How does gin route requests through its middleware chain? |
| [flask](https://github.com/pallets/flask) | Python | How does Flask dispatch a request to a view function? |
| [tokio](https://github.com/tokio-rs/tokio) | Rust | How does tokio schedule and run async tasks on its runtime? |
| [gson](https://github.com/google/gson) | Java | How does Gson serialize an object to JSON? |
| [redis](https://github.com/redis/redis) | C | How does Redis parse and dispatch a client command? |
| [leveldb](https://github.com/google/leveldb) | C++ | How does LevelDB read and write a key through its storage engine? |
| [sinatra](https://github.com/sinatra/sinatra) | Ruby | How does Sinatra match a request to a route handler? |
| [slim](https://github.com/slimphp/Slim) | PHP | How does Slim handle a request through its middleware? |
| [serilog](https://github.com/serilog/serilog) | C# | How does Serilog route a log event to its sinks? |
| [koin](https://github.com/InsertKoinIO/koin) | Kotlin | How does Koin resolve and inject dependencies? |
| [alamofire](https://github.com/Alamofire/Alamofire) | Swift | How does Alamofire build, send, and validate a request? |
| [lualine](https://github.com/nvim-lualine/lualine.nvim) | Lua | How does lualine assemble and render its statusline sections and components? |
| [darthttp](https://github.com/dart-lang/http) | Dart | How does the http package send a request and produce a response? |

<details>
<summary><code>codex</code> · <code>gpt-5.4-mini</code> — median token reduction 78% (codegraph 52%, serena 5%)</summary>

![Agent token cost — dedicated question, per repository](https://raw.githubusercontent.com/samchon/graph/master/assets/benchmark-codex-gpt-5.4-mini-dedicated.svg)

</details>

### Indexing time

| Project | Language | First index |
|---|---|---|
| [slim](https://github.com/slimphp/Slim) | PHP | 5s |
| [excalidraw](https://github.com/excalidraw/excalidraw) | TypeScript | 5s |
| [gin](https://github.com/gin-gonic/gin) | Go | 15s |
| [leveldb](https://github.com/google/leveldb) | C++ | 16s |
| [darthttp](https://github.com/dart-lang/http) | Dart | 23s |
| [lualine](https://github.com/nvim-lualine/lualine.nvim) | Lua | 25s |
| [flask](https://github.com/pallets/flask) | Python | 55s |
| [gson](https://github.com/google/gson) | Java | 2m22s |
| [sinatra](https://github.com/sinatra/sinatra) | Ruby | 2m35s |
| [redis](https://github.com/redis/redis) | C | 2m50s |
| [tokio](https://github.com/tokio-rs/tokio) | Rust | 3m |
| [koin](https://github.com/InsertKoinIO/koin) | Kotlin | 19m25s |
| [serilog](https://github.com/serilog/serilog) | C# | not recorded |
| [alamofire](https://github.com/Alamofire/Alamofire) | Swift | not recorded |

One-time cost per repository. The server re-scans only changed files after that (see [How it works](#how-it-works)); later calls are free.

kotlin-language-server, jdtls, and csharp-ls are particularly slow: each resolves the whole project before answering anything.

Closing that gap needs what `@ttsc/graph` already does for TypeScript: a compiler-native indexer instead of a generic LSP server. Not done here.

### Reproduction

Running the suite spends real API credits, so it is never wired into CI:

```bash
git clone https://github.com/samchon/graph
cd graph
pnpm install
pnpm --filter @samchon/graph-benchmark corpus      # 14 repos / 14 languages, pinned
pnpm --filter @samchon/graph-benchmark preflight   # zero-spend go/no-go
pnpm --filter @samchon/graph-benchmark suite-codex -- --runs=1       # codex / gpt-5.4-mini
pnpm --filter @samchon/graph-benchmark suite-parallel -- --runs=1    # Claude Code / sonnet
pnpm --filter @samchon/graph-benchmark render      # results -> SVG charts
```

## How it works

```typescript
/**
 * <MCP_SERVER_INSTRUCTION>
 */
export interface ISamchonGraphApplication {
  /**
   * <TOOL_DESCRIPTION>
   */
  inspect_code_graph(
    props: ISamchonGraphApplication.IProps,
  ): Promise<ISamchonGraphApplication.IResult>;
}

export namespace ISamchonGraphApplication {
  export interface IProps {
    question: string; // restate the code question being asked
    draft: IDraft;    // the request type it plans, and why it is the smallest
    review: string;   // self-correct a wrong/broad draft; pick `escape` if off-graph
    request:          // the final operation, chosen after review
      | ISamchonGraphEntrypoints.IRequest // orientation: where to start reading
      | ISamchonGraphLookup.IRequest      // find a symbol by name
      | ISamchonGraphTrace.IRequest       // trace call / data flow
      | ISamchonGraphDetails.IRequest     // a symbol's signature, members, neighbors
      | ISamchonGraphOverview.IRequest    // repo-level overview
      | ISamchonGraphTour.IRequest        // broad code tour, answered in one call
      | ISamchonGraphEscape.IRequest;     // not a graph question -> bail out
  }

  export interface IDraft {
    reason: string;                  // why this is the smallest useful step
    type: IProps["request"]["type"]; // the request type being considered
  }
}
```

> [`packages/graph/src/structures/ISamchonGraphApplication.ts`](https://github.com/samchon/graph/blob/master/packages/graph/src/structures/ISamchonGraphApplication.ts)

### Chain of thought

`question`, `draft`, and `review` are required fields, so the model writes its reasoning into the call itself: state the question, draft the smallest request, then review the draft. A prompt line can be ignored; a required field cannot.

The review is allowed to overturn the draft, and that matters more than the planning. When an agent like Claude Code enters the tool with a question the graph cannot answer, `review` replaces the drafted request on the spot, and `escape` backs out entirely. A wrong entry costs one small call instead of a derailed session.

### Precision over restriction

Nothing is forbidden. The tool description says when the graph applies and when to stop. Grep and file reads stay available, and the agent still uses them when they are the right move.

What keeps the agent on the graph is precision. Answers carry names, signatures, edges, and spans resolved by a language server, so the agent accepts them as final instead of re-verifying with its own reads. And since no file body is ever included, a large repository cannot inflate the response.

### Comparison

[`serena`](https://github.com/oraios/serena) and [`codegraph`](https://github.com/colbymchenry/codegraph) fight the agent instead:

- dozens of tools around one graph, so the agent often picks the wrong entry point
- 100–150 lines of injected instructions, spent mostly on forbidding grep and file reads
- source snippets inlined into answers, which reintroduces the reading cost a graph exists to remove
- loosely structured answers the agent does not trust, so it goes back to reading the files to verify them
- no way to back out, so a wrong entry keeps paying tool calls instead of escaping

Here the same policy fits in one typed contract, enforced by schema instead of pleaded for in prose.

## Sponsors

[![Sponsors](https://raw.githubusercontent.com/samchon/sponsor-images/refs/heads/master/public/circle.svg)](https://github.com/sponsors/samchon)

Thanks for your support.

Your [donation](https://github.com/sponsors/samchon) encourages `@samchon/graph` development.

## References

- Motivation: real-world use of [`codegraph`](https://github.com/colbymchenry/codegraph) that raised token cost instead of lowering it and visibly degraded agent reasoning.
- Predecessor: [`@ttsc/graph`](https://github.com/samchon/ttsc), the TypeScript-only original that this project generalizes; its [launch post](https://ttsc.dev/blog/i-made-ts-compiler-graph-mcp/) analyzes why earlier graph tools did not reduce the token bill.
- Function calling harness: [part 1 — validation feedback](https://dev.to/samchon/qwen-meetup-function-calling-harness-from-675-to-100-3830) and [part 2 — CoT compliance](https://dev.to/samchon/function-calling-harness-2-cot-compliance-from-991-to-100-4f0h), the typia technique the contract is built on.
- Compared against: [`codegraph`](https://github.com/colbymchenry/codegraph) and [`serena`](https://github.com/oraios/serena).
- Protocol: the [Model Context Protocol](https://modelcontextprotocol.io) and the [Language Server Protocol](https://microsoft.github.io/language-server-protocol/).
- Validation & MCP surface: [`typia`](https://github.com/samchon/typia) and [`@typia/mcp`](https://github.com/samchon/typia).
