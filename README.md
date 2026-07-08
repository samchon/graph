# `@samchon/graph`

[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/samchon/graph/blob/master/LICENSE) [![NPM Version](https://img.shields.io/npm/v/@samchon/graph.svg)](https://www.npmjs.com/package/@samchon/graph) [![NPM Downloads](https://img.shields.io/npm/dm/@samchon/graph.svg)](https://www.npmjs.com/package/@samchon/graph) [![Build Status](https://github.com/samchon/graph/workflows/test/badge.svg)](https://github.com/samchon/graph/actions?query=workflow%3Atest)

**A code graph that answers "how does this repo work?" without your agent reading the repo.**

`@samchon/graph` is an MCP server. It indexes a codebase — across **18 languages** — into a graph of declarations and their relationships, and answers an agent's orientation questions from that graph instead of from source files. The agent gets the map in one call rather than grepping and reading its way through dozens of files.

That collapses the token cost. On a 12-language benchmark it cuts the agent's tokens by a **median of 96%** on onboarding questions — while [`codegraph`](https://github.com/colbymchenry/codegraph) cuts 63% and [`serena`](https://github.com/oraios/serena) makes it *worse*.

![Agent token cost — onboarding, per repository](https://raw.githubusercontent.com/samchon/graph/master/assets/benchmark-common.svg)

## Setup

### 1. Add the MCP server

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

Start the client from the project root. The server builds one resident graph and answers every MCP call from memory. With no language server installed it still works — the **static indexer** parses the source directly (every language indexes in ~1–2 seconds, even on large repositories).

### 2. Install a language server (optional, for compiler-grade edges)

A language server sharpens the graph with semantically-resolved edges. Install the one(s) for your stack — nothing else is auto-provided (an installed editor like VS Code does **not** expose a stdio language server):

| Language | Server | Install |
|---|---|---|
| TypeScript / JavaScript | `typescript-language-server` | `npm i -g typescript-language-server typescript` |
| Python | `pyright-langserver` | `npm i -g pyright` |
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
| PHP | `intelephense` | `npm i -g intelephense` |
| Lua | `lua-language-server` | LuaLS/lua-language-server |
| Dart | `dart` | ships with the Dart SDK |
| Bash | `bash-language-server` | `npm i -g bash-language-server` |

Each server must be on `PATH`. If none is present for a file's language, that language falls back to the static indexer automatically.

### 3. TypeScript / JavaScript — the fast path

The community `typescript-language-server` is an unofficial wrapper over the classic `tsserver` and answers references one symbol at a time. For compiler-grade TS/JS graphs at native speed, point the server at **[`ttscserver`](https://github.com/samchon/ttsc)** (the `typescript-go`–backed LSP host) once it exposes the graph channel — tracked in [samchon/ttsc#335](https://github.com/samchon/ttsc/issues/335) and [#337](https://github.com/samchon/ttsc/issues/337).

## Benchmark

Reproduce the numbers yourself (spends real credits, never wired into CI):

```bash
pnpm --filter @samchon/graph-benchmark corpus      # 12 repos / 12 languages, pinned
pnpm --filter @samchon/graph-benchmark preflight   # zero-spend go/no-go
pnpm --filter @samchon/graph-benchmark suite-codex -- --runs=1
pnpm --filter @samchon/graph-benchmark render      # results -> SVG charts
```

## How it works

The whole surface is one tool with one typed contract:

```typescript
export interface ISamchonGraphApplication {
  inspect_code_graph(
    props: ISamchonGraphApplication.IProps,
  ): Promise<ISamchonGraphApplication.IResult>;
}

export namespace ISamchonGraphApplication {
  export interface IProps {
    question: string; // restate the code question
    draft: IDraft; //    intended request + why it is smallest
    review: string; //   correct the draft before committing
    request:
      | IGraphTour.IRequest //    broad orientation / runtime flow
      | IGraphLookup.IRequest //  find a symbol
      | IGraphTrace.IRequest //   follow a flow
      | IGraphDetails.IRequest // one symbol's facts
      | IGraphEntrypoints.IRequest
      | IGraphOverview.IRequest
      | IGraphEscape.IRequest; // leave the graph
  }

  export interface IDraft {
    reason: string; //                   why this is the smallest useful step
    type: IProps["request"]["type"]; //  the request type being considered
  }
}
```

The other tools try to change what the agent does by *talking* to it — `serena` swaps in ~150 lines of system prompt, `codegraph` ships ~100 lines plus a skill file, both spent almost entirely on forbidding the agent from grepping anyway. `@samchon/graph` changes the **shape of the tool** instead:

- **One tool, not fifty.** `serena` buries its graph behind ~50 tools and the agent never finds the right one; `@samchon/graph` has exactly one, and a union type — filled in by the chain-of-thought — routes the request by construction instead of by persuasion.
- **CoT compliance, not a wall of rules.** A required schema field can't be skipped the way a prompt line can be ignored. `props` makes the model write `question` → `draft` → `review` before it may act — so it reasons first, and a `review`/`escape` step catches a wrong turn.
- **Index facts, not inlined source.** The result is names, signatures, and spans — never pasted file bodies. That is where the tokens actually go: the baseline agent blows its budget dumping source into context, while the graph answers the same question from the index.
- **It respects the agent, it doesn't cage it.** No "use this instead of Read." It states a condition, then tells the agent where to stop — so the agent reaches for the graph when it should and skips it when it shouldn't.

This is the design proven by the TypeScript-only predecessor, [`@ttsc/graph`](https://ttsc.dev/blog/i-made-ts-compiler-graph-mcp) — the launch post is the full autopsy of why the tools before it don't move the token bill. `@samchon/graph` generalizes it to 18 languages over LSP, with edges built by a single linear pass per file (a 2,000-file repo indexes in **~1.6 seconds**, re-indexed incrementally as source changes).

## Sponsors

[![Sponsors](https://raw.githubusercontent.com/samchon/sponsor-images/refs/heads/master/public/circle.svg)](https://github.com/sponsors/samchon)

Thanks for your support.

Your [donation](https://github.com/sponsors/samchon) encourages `@samchon/graph` development.

## References

- Predecessor: [`@ttsc/graph`](https://github.com/samchon/ttsc) — the TypeScript-only, compiler-powered original this generalizes.
- Compared against: [`codegraph`](https://github.com/colbymchenry/codegraph) and [`serena`](https://github.com/oraios/serena).
- Protocol: the [Model Context Protocol](https://modelcontextprotocol.io) and the [Language Server Protocol](https://microsoft.github.io/language-server-protocol/).
- Validation & MCP surface: [`typia`](https://github.com/samchon/typia) and [`@typia/mcp`](https://github.com/samchon/typia).
