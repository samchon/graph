# `@samchon/graph` Benchmark Harness

Two benchmarks, mirroring the two `@ttsc/graph` and codegraph publish: a **structural** one (build time, node/edge counts) and an **agent-cost A/B** (the "X% fewer tokens" comparison).

## Structural benchmark

Clones representative repositories, builds graph dumps, and records timing and graph-size metrics.

```bash
pnpm --filter @samchon/graph-benchmark list
pnpm --filter @samchon/graph-benchmark start -- --fixture typeorm --mode static
```

## Agent-cost A/B (`agent-ab.mjs`)

A port of codegraph's headline agent-cost benchmark (and of `@ttsc/graph`'s faithful port of it), **generalized across languages**. For one question per repo it runs the Claude Code CLI headless twice — once with the `@samchon/graph` MCP server enabled and once with an empty MCP config, both under `--strict-mcp-config` — and reports codegraph's metrics: tokens summed per assistant turn, tool-call count, cost, and wall time, median over N runs.

The repositories and their `dedicated` questions are taken verbatim from codegraph's evaluation corpus (`src/corpus.mjs`), spanning 13 languages. The shared `common` onboarding question (`questions/common.md`) is asked against every repo to test whether orientation cost stays flat. **The prompt is tool-neutral** — no graph guidance is appended; the tool guidance lives only in the MCP server's tool descriptions, so both arms pose the identical question and the token comparison stays honest.

> This **spends real Claude credits**, is non-deterministic, and is deliberately **not** wired into CI. It requires `claude` on `PATH` and a built package (`pnpm --filter @samchon/graph build`). The MCP server is the package's own launcher (`packages/graph/lib/bin.js --cwd <repo>`), which builds one resident graph and serves `inspect_code_graph` over stdio.

```bash
# List the corpus (repos, languages, dedicated questions)
pnpm --filter @samchon/graph-benchmark corpus

# One repo, dedicated question, both arms
pnpm --filter @samchon/graph-benchmark agent-ab -- --repo=gin --prompt-family=dedicated --runs=4

# The shared onboarding question against a repo, opus
pnpm --filter @samchon/graph-benchmark agent-ab -- --repo=flask --prompt-family=common --runs=4 --model=opus

# Comparator arm: serena instead of @samchon/graph (needs `uvx` on PATH)
pnpm --filter @samchon/graph-benchmark agent-ab -- --repo=express --serena=1 --runs=2

# The whole corpus, both prompt families, with a summary table
pnpm --filter @samchon/graph-benchmark suite -- --runs=4 --model=sonnet
```

Reports and per-run stream-json traces are written under `results/`. Each report records the arm samples (tokens, tools, cost, wall time, and the agent's final answer) so a run can be re-inspected without re-spending credits.

### Arms

- `baseline` — empty MCP config; Read/Grep/Bash only.
- `graph` — the `@samchon/graph` MCP server.
- `--serena=1` / `--cg=1`-style comparators reuse the identical prompt and gates.

Select arms with `--arm=baseline|graph|both` so a fixed baseline can be measured once and cached while graph iterations rerun only the MCP arm.
