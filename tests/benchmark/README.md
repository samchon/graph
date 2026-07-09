# `@samchon/graph` Benchmark Harness

Two benchmarks, mirroring the two `@ttsc/graph` and codegraph publish: a **structural** one (build time, node/edge counts) and an **agent-cost A/B** (the "X% fewer tokens" comparison).

## Agent-cost A/B

A faithful port of codegraph's headline agent-cost benchmark (and of `@ttsc/graph`'s port of it), **generalized across languages**. For one question per repo an agent CLI runs headless once per arm — `baseline` (no MCP) vs a graph tool — and the report carries tokens summed per turn, tool calls, and wall time, median over N runs. Arms: **@samchon/graph** (default), **codegraph** (`--cg=1`), **serena** (`--serena=1`).

Two harnesses share the same corpus, prompts, and gates:

- **`src/agent-ab-codex.mjs`** — OpenAI `codex` CLI (default `gpt-5.4-mini`, reasoning `high`). Each arm gets a minimal temp `CODEX_HOME` (copied `auth.json` + generated `config.toml`) so nothing but the MCP server differs. `codex --json` has no cost field, so tokens/tools/time are the metrics.
- **`src/agent-ab.mjs`** — Claude Code CLI (`--strict-mcp-config`, per-arm MCP config, `--max-budget-usd`), reporting cost as well.

### Rigor gates

- **Prompt provenance** — every prompt resolves through `questions/manifest.json` and the harness refuses to run when a question file no longer matches its pinned SHA-256; `promptId` + `questionSha256` are recorded on every sample. Regenerate after editing questions with `pnpm --filter @samchon/graph-benchmark manifest`.
- **Pinned checkouts** — every corpus entry pins the exact `commit` measured; the clone fetches that commit, never a moving branch.
- **Graph-arm preflight** — before spending, the harness builds a bounded dump of the checkout and **aborts if the language server is missing** (`indexer: "static"`); a silent static fallback would corrupt the comparison. Override only with `--allow-static=1`.
- **codegraph setup cost** — the codegraph arm runs `codegraph init` first and records its wall time as `toolSetupMs`.
- **Tool-neutral prompts** — no graph guidance is appended to the question; tool guidance lives only in each MCP server's own descriptions, so every arm poses the identical utterance.

### Corpus

14 repos, one per language, taken **verbatim** from codegraph's evaluation suite — repositories and dedicated questions alike (`src/corpus.mjs` + `questions/*.md`). JavaScript is intentionally excluded because `.js`/`.jsx`/`.mjs`/`.cjs` files cannot be distinguished reliably from TypeScript build output in arbitrary repositories; scala, zig, and bash are deliberately absent because codegraph has no dedicated utterance for them. The shared `common` onboarding question is asked against every repo.

```bash
pnpm --filter @samchon/graph-benchmark corpus      # list repos, commits, questions
pnpm --filter @samchon/graph-benchmark preflight   # zero-spend go/no-go matrix
```

### Running (spends real credits — user-triggered only, never CI)

```bash
# One cell: repo x family x tool (baseline arm cached separately)
pnpm --filter @samchon/graph-benchmark codex -- --repo=gin --prompt-family=dedicated --arm=baseline
pnpm --filter @samchon/graph-benchmark codex -- --repo=gin --prompt-family=dedicated --arm=graph
pnpm --filter @samchon/graph-benchmark codex -- --repo=gin --prompt-family=dedicated --arm=graph --cg=1
pnpm --filter @samchon/graph-benchmark codex -- --repo=gin --prompt-family=dedicated --arm=graph --serena=1

# The whole suite: baseline measured ONCE per repo x family, then each tool;
# existing reports are skipped, so an interrupted suite resumes for free.
pnpm --filter @samchon/graph-benchmark suite-codex -- --runs=1
```

Reports land in `results/codex-<repo>-<family>-<tool>.json` (committed as the measurement record); per-run stream traces in `results/*.traces/` (gitignored).

### Rendering

```bash
pnpm --filter @samchon/graph-benchmark render
```

Reads every `results/codex-*.json` and writes `results/benchmark-<harness>-<model>-<family>.svg` (e.g. `benchmark-codex-gpt-5.4-mini-common.svg`): grouped bars per repo (baseline gray + a fixed, CVD-validated tool order) with direct value labels and % vs baseline. Each SVG embeds a `prefers-color-scheme` media query, so one file adapts to light and dark in a plain `<img>`.

## Structural benchmark

Clones representative repositories, builds graph dumps, and records timing and graph-size metrics.

```bash
pnpm --filter @samchon/graph-benchmark list
pnpm --filter @samchon/graph-benchmark start -- --fixture typeorm --mode static
```
