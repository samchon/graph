# `@samchon/graph`

[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/samchon/graph/blob/master/LICENSE) [![NPM Version](https://img.shields.io/npm/v/@samchon/graph.svg)](https://www.npmjs.com/package/@samchon/graph) [![NPM Downloads](https://img.shields.io/npm/dm/@samchon/graph.svg)](https://www.npmjs.com/package/@samchon/graph) [![Build Status](https://github.com/samchon/graph/workflows/test/badge.svg)](https://github.com/samchon/graph/actions?query=workflow%3Atest)

A language-neutral code graph over MCP that slashes an agent's token cost.

`@samchon/graph` is the multi-language successor to [`@ttsc/graph`](https://github.com/samchon/ttsc). It exposes **one** MCP tool, `inspect_code_graph`, that returns a bounded, **source-free** index of a repository — declarations, signatures, source-span anchors, and the relationships between them (imports, calls, type references, member access, containment, inheritance, decorators, overrides) — plus diagnostics when a language server can provide them, and a `next` contract telling the agent whether to answer, inspect once more, leave the graph, or ask for clarification.

Instead of an agent grepping and reading dozens of files to orient itself, one `tour` or `lookup` call returns the answer-ready map. Across a 12-language benchmark that cuts the agent's tokens by a **median of 96%** on onboarding questions — beating [`codegraph`](https://github.com/colbymchenry/codegraph) and [`serena`](https://github.com/oraios/serena).

- one tool, not a garden of narrow tools;
- required `question`, `draft`, and `review` reasoning fields before the request branch;
- graph evidence only, never source bodies;
- language-server truth when a server is installed, a fast static fallback when it is not;
- **18 languages**: TypeScript, JavaScript, Go, Python, Rust, Java, C, C++, C#, Kotlin, Swift, Scala, Zig, Ruby, PHP, Lua, Dart, Bash.

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

A faithful port of `codegraph`'s headline agent-cost benchmark, generalized across languages. For one question per repository the `codex` CLI runs headless, once per arm — **baseline** (no MCP) vs `@samchon/graph` vs `codegraph` vs `serena` — and the report sums tokens per assistant turn, median over the runs. Prompts are `codegraph`'s own utterances, pinned by SHA-256; checkouts are pinned by commit; every arm poses the identical question (tool guidance lives only in each server's MCP descriptions).

**Onboarding question, per repository — @samchon/graph cuts a median of 96% of tokens (n=12), vs codegraph 63% and serena +2% (worse than no tool):**

![Agent token cost — onboarding, per repository](https://raw.githubusercontent.com/samchon/graph/master/assets/benchmark-common.svg)

| | @samchon/graph | codegraph | serena |
|---|---|---|---|
| **median vs baseline** | **−96%** | −63% | +2% (worse) |
| repositories improved | 12 / 12 | 10 / 12 | 3 / 12 |

Ten of twelve languages land between **−92% and −98%** with a single graph call. `@samchon/graph` wins even where the underlying language server is weak: on Ruby (ruby-lsp) it still cuts **−63%**, ahead of codegraph's −49% and serena's −15%.

Run it yourself (spends real credits, never wired into CI):

```bash
pnpm --filter @samchon/graph-benchmark corpus      # 12 repos / 12 languages, pinned
pnpm --filter @samchon/graph-benchmark preflight   # zero-spend go/no-go
pnpm --filter @samchon/graph-benchmark suite-codex -- --runs=1
pnpm --filter @samchon/graph-benchmark render      # results -> SVG charts
```

## Why the difference is so large

**The baseline agent greps.** With no graph it opens the entry file, follows imports by reading them, `rg`s for symbol names, reads the hits, and repeats — dozens of tool calls and tens of thousands of tokens of source text just to orient itself. That is where a million tokens go on a large repository.

**`@samchon/graph` answers structure from structure.** The graph already holds every declaration, its span, and its edges. A `tour` call runs a relevance-scored flow traversal and returns the central entrypoints, the primary runtime flow, the nearby paths, the tests, and citation anchors — the whole orientation surface — in **one call**, as index facts rather than pasted source. The agent reads the map and answers. On the flagship TypeScript repo the tour surfaces the exact canvas/render entrypoints for a canvas-render question, with a 20-step flow, in a single call.

Three things make that work, all ported faithfully from `@ttsc/graph`:

- **A sacred contract.** The tool's own description tells the agent the returned facts are language-server truth: *answer from them, don't re-verify with grep.* That stops the agent from second-guessing a correct graph into another 30 file reads.
- **A complete engine.** `tour`/`trace`/`details` don't return a thin seed list; they compute the ranked flow, the impact set, the dependency neighborhood — a complete answer, so the agent doesn't fall back to searching.
- **Bounded, source-free evidence.** Names, signatures, and spans — never file bodies. The payload stays small no matter how large the repository.

**Why serena often costs *more* than no tool:** a broad orientation tool that returns partial evidence invites the agent to call it many times and then grep anyway, stacking overhead on top of the search it was meant to replace. The benchmark shows this directly — serena is a net loss on the median.

The graph itself is built for scale: edges are extracted by a single linear pass over each file (an identifier scan resolved against a name index), so a 2,000-file repository indexes in **~1.6 seconds** rather than the minutes a per-symbol reference sweep would take, and it re-indexes incrementally as source changes.

## Sponsors

[![Sponsors](https://raw.githubusercontent.com/samchon/sponsor-images/refs/heads/master/public/circle.svg)](https://github.com/sponsors/samchon)

Thanks for your support.

Your [donation](https://github.com/sponsors/samchon) encourages `@samchon/graph` development.

## References

- Predecessor: [`@ttsc/graph`](https://github.com/samchon/ttsc) — the TypeScript-only, compiler-powered original this generalizes.
- Compared against: [`codegraph`](https://github.com/colbymchenry/codegraph) and [`serena`](https://github.com/oraios/serena).
- Protocol: the [Model Context Protocol](https://modelcontextprotocol.io) and the [Language Server Protocol](https://microsoft.github.io/language-server-protocol/).
- Validation & MCP surface: [`typia`](https://github.com/samchon/typia) and [`@typia/mcp`](https://github.com/samchon/typia).
