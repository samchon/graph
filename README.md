# `@samchon/graph`

[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/samchon/graph/blob/master/LICENSE) [![NPM Version](https://img.shields.io/npm/v/@samchon/graph.svg)](https://www.npmjs.com/package/@samchon/graph) [![NPM Downloads](https://img.shields.io/npm/dm/@samchon/graph.svg)](https://www.npmjs.com/package/@samchon/graph) [![Build Status](https://github.com/samchon/graph/workflows/test/badge.svg)](https://github.com/samchon/graph/actions?query=workflow%3Atest)

`@samchon/graph` is an MCP server that gives AI agents a code graph instead of source files.

It indexes a codebase in 17 languages into a graph of declarations and their relationships, and answers an agent's code questions from that index through a single tool. Semantic edges come from each language's language server when one is installed; otherwise a built-in static parser takes over.

Agents like Claude Code and Codex normally answer a code question by grepping the repository and reading file after file into context, and that reading is most of the token bill. The graph removes the need for it, and its own answers stay small in turn: they carry names, signatures, relationships, and source spans, never file bodies.

Since neither side of that exchange grows with the repository, the cost falls by about the same proportion in every situation, on every codebase. That even distribution is what separates this from [`codegraph`](https://github.com/colbymchenry/codegraph) and [`serena`](https://github.com/oraios/serena), and it shows directly in the chart below:

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

JavaScript is intentionally not indexed: in arbitrary repositories, `.js`/`.jsx`/`.mjs`/`.cjs` files are often TypeScript build output or vendored bundles, and the graph cannot distinguish those from handwritten source without project-specific provenance.

## Benchmark

Each repository is measured with one headless agent run per arm (`baseline` with no MCP, `@samchon/graph`, `codegraph`, `serena`) on two prompt families. The corpus pins 14 repositories, one per language.

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

### Reproduction

Running the suite spends real API credits, so it is never wired into CI:

```bash
git clone https://github.com/samchon/graph
cd graph
pnpm install
pnpm --filter @samchon/graph-benchmark corpus      # 14 repos / 14 languages, pinned
pnpm --filter @samchon/graph-benchmark preflight   # zero-spend go/no-go
pnpm --filter @samchon/graph-benchmark suite-codex -- --runs=1
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

The whole surface is one tool with one typed contract.

`serena` and `codegraph` steer the agent with instructions: `serena` replaces about 150 lines of system prompt, `codegraph` ships about 100 lines plus a skill file, and both spend most of that on telling the agent not to grep. `@samchon/graph` encodes the policy in the tool's type signature instead:

- There is a single tool. `serena` spreads its graph over about 50 tools and the agent often picks the wrong one; here the request union routes every question through one entry point.
- The required `question`, `draft`, and `review` fields cannot be skipped the way a prompt line can be ignored, so the model reasons about the request before making it, and a wrong draft is corrected at the `review` step or redirected to `escape`.
- Results carry names, signatures, and spans, never file bodies. Pasting source into context is where the baseline agent's tokens go, and that cost is what the index removes.
- The tool description states when the graph applies and when to stop, rather than forbidding file reads, so the agent still opens files when that is the right move.

## Sponsors

[![Sponsors](https://raw.githubusercontent.com/samchon/sponsor-images/refs/heads/master/public/circle.svg)](https://github.com/sponsors/samchon)

Thanks for your support.

Your [donation](https://github.com/sponsors/samchon) encourages `@samchon/graph` development.

## References

- Predecessor: [`@ttsc/graph`](https://github.com/samchon/ttsc), the TypeScript-only original that this project generalizes.
- Compared against: [`codegraph`](https://github.com/colbymchenry/codegraph) and [`serena`](https://github.com/oraios/serena).
- Protocol: the [Model Context Protocol](https://modelcontextprotocol.io) and the [Language Server Protocol](https://microsoft.github.io/language-server-protocol/).
- Validation & MCP surface: [`typia`](https://github.com/samchon/typia) and [`@typia/mcp`](https://github.com/samchon/typia).
