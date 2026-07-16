# Graph Agent Benchmark

Read this document before running or changing `tests/benchmark/graph.mjs`, files under `tests/benchmark/graph/`, benchmark prompts or fixtures, trace auditing, comparator setup, `tests/benchmark/results/graph.json`, or tracked benchmark assets.

## Workload And Fixtures

The benchmark measures coding-agent cost across an empty-MCP baseline and the `samchon-graph`, `codegraph`, `codebase-memory`, and `serena` arms. It supports Codex and Claude Code, with `common` onboarding and repository-specific `dedicated` prompt families.

`tests/benchmark/graph/corpus.mjs` pins the repository and full 40-character commit for each fixture. `tests/benchmark/graph/questions/manifest.json` binds every normalized prompt to its SHA-256, language, and fixture commit. Regenerate the manifest with `generate-manifest.mjs`; do not hand-edit hashes or commits.

The runner clones fixtures beside the repository under `../graph-benchmark-work`. This boundary is part of validity because both agent CLIs search parent directories for repository instructions. A fixture nested under this checkout would inherit `@samchon/graph`'s own `AGENTS.md` and contaminate every cell.

Each paid arm runs with isolated minimal agent configuration. Preserve identical user utterances and the pinned checkout. The measured graph server must build the full language-server-backed graph for the selected fixture; a silent static fallback is not the intended product cell.

## Comparator Setup

- **codegraph:** perform its documented initialization, record setup time, local-ignore its index, and remove it unless the selected keep-index option says otherwise.
- **codebase-memory:** index with an isolated cache directory, record setup time, local-ignore the index, and remove it unless explicitly retained.
- **Serena:** launch the documented stdio server, perform its prescribed project indexing, record setup time, local-ignore its project data, and remove it unless explicitly retained.

Do not skip required setup to make a comparator look slower or less capable. Cleanup must stay inside the resolved fixture root; refuse an index removal whose target escapes that root.

## Deterministic And External Gates

The zero-API-cost checks are:

```bash
pnpm --filter @samchon/graph build
pnpm --filter @samchon/graph-benchmark test
pnpm --filter @samchon/graph-benchmark corpus
pnpm --filter @samchon/graph-benchmark preflight
```

`test` is deterministic and local. `corpus` and especially `preflight` may clone repositories, install project dependencies, prepare language projects, and run real language servers even though they do not spend model credits. Run those external setup lanes only when the task requires them and the environment can tolerate their network, disk, and toolchain cost.

Paid agent commands include:

```bash
node tests/benchmark/graph/run-suite.mjs --arm=baseline --runs=5 --harness=codex --model=gpt-5.4-mini
node tests/benchmark/graph/run-suite.mjs --arm=graph --runs=1 --harness=codex --model=gpt-5.4-mini
node tests/benchmark/graph.mjs --all --arm=baseline --tools=baseline --prompt-families=all --models=gpt-5.4-mini --runs=1
node tests/benchmark/graph.mjs --all --arm=graph --tools=all --prompt-families=all --models=gpt-5.4-mini --runs=1
node tests/benchmark/graph/audit-codex-traces.mjs --report=<report.json>
```

These commands use authenticated agent CLIs and spend API credits. Never run them merely because a source change might affect benchmark performance; obtain explicit authorization for the intended scope, harness, models, tools, prompt families, and sample counts.

## Sampling And Publication

The reference improvement loop measures a five-run baseline and one-run product iterations. Preserve every raw sample and derive medians where the runner does. Repository breadth is not permission to average away a bad cell; inspect each cell and its trace.

Parallel sweeps must use `--no-website` and unique output directories. Publish completed, audited suites afterward:

```bash
node tests/benchmark/graph/publish.mjs --from <suite-output-directory>
node tests/benchmark/build/graph-benchmark-svg.cjs --png
```

Do not use `--reset` for an ordinary refresh. It discards the accumulated cell set. Use it only when intentionally rebuilding the entire publication in one controlled sequence.

`tests/benchmark/graph/website-cell.mjs` is the single cell identity. Key only by axes the presentation renders: harness, tool, repository, prompt, model, and daemon mode. Fixture commits, effort, setup time, and other measurement metadata must not create duplicate visible cells.

A publishable cell has the requested non-empty samples, positive token use, exact provenance, and successful trace audit. A graph-arm sample must call the MCP and, under the current publication gate, must not fall back to shell, source, or web reads. Preserve invalid spent-token samples in raw evidence; do not publish them as valid cells or silently retry them away.

## Trace Audit

Codex suites preserve trace data for `audit-codex-traces.mjs`. The audit may report only exposed assistant messages, shell and MCP calls, per-turn usage, and available reasoning-token counters. Codex does not expose hidden reasoning text; never invent it.

Interpret trace categories carefully:

- duplicate MCP calls and duplicate serialized evidence can be exact avoidable output;
- shell/source reads show that the graph result did not settle the agent, but the trace must establish why;
- broad graph requests and overfetch are candidate ceilings, not automatically removable cost;
- later turn-completion usage can expose prompt replay; and
- unexplained input is an accounting gap, not proof of a hidden category.

Use the audit's own comparison mode for before-and-after reports rather than comparing selected headline fields by hand.

## Changing `@samchon/graph`

The following decisions remain closed:

- no source bodies in graph results;
- no benchmark-only hardcoding, monkey patches, or overfitting;
- no suppression of a legitimate agent follow-up merely to improve the number;
- closures stay out of tour seeds, reach, and flows when they create unbounded expansion; and
- tours remain index-level orientation, not a path-stitching engine.

### Compute Blast Radius First

Ranking changes propagate through the whole tour. Seed order changes flows, which change nearby nodes, tests, evidence, and anchors. Before spending model tokens, run the old and new operations offline across the affected fixture and prompt-family matrix, diff payloads, and predict the effect of every changed cell. Byte-identical payloads cannot demonstrate a server-side result change.

### Re-Measure The Affected Arm

A graph algorithm, instruction, schema, tool description, audit, `next`, or runner-text change can affect every `samchon-graph` cell. Re-measure the complete affected product arm across repositories, harnesses, models, and both prompt families before publishing a new headline. Baseline and comparator arms may stand only when the changed code cannot affect them.

A cell that loses reduction, adds fallback reads, or stops calling the graph blocks publication until its trace explains the cause and the cause is fixed or the regression is explicitly accepted. Validate cells individually, not only by aggregate or family average.

### Keep Tool Claims True

Audit text may claim only facts the server checked. `next` may state only what the returned result establishes; it cannot infer whether identifier text semantically covered the user's intent. Do not add an instruction that suppresses a legitimate follow-up or invents a reason to inspect.

When reality contradicts the predicted result, investigate or revert before stacking another ranking patch. A surprising benchmark cell is a failed understanding gate, not a target for a local special case.
