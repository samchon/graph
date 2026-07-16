---
name: project
description: Defines the @samchon/graph product contract, workspace layout, public and generated-file boundaries, and canonical commands. Use when orienting in the repository, working inside any package, or choosing a build, test, coverage, experiment, or benchmark command.
---

# Project Outline

## Product Contract

`@samchon/graph` is a code-graph index for coding agents. It discovers supported source languages, asks installed language servers for semantic declarations and relationships, and merges the separately packaged `@samchon/graph-sitter` best-effort fallback for languages whose server is missing or fails. It serves the resident result through one typed MCP tool and also exposes a TypeScript API plus the `samchon-graph`, `samchon-graph dump`, and `samchon-graph view` CLI lanes.

The graph is an index, not a source-delivery system. Results carry declarations, signatures, relations, decorators, diagnostics, tests, anchors, and source spans. They do not inline implementation bodies. When body text or an exact textual match is needed, return or use the smallest span and read the source normally.

The graph has two distinct trust levels:

- Facts such as nodes, edges, signatures, decorators, tests, and spans are checked against the synchronized index snapshot before return.
- Ranked selection in `lookup`, `entrypoints`, and `tour` is heuristic. Its facts remain checked, but callers must judge whether the shortlist covers the question.

Keep the MCP contract typed and structured. Request and result union members pair by discriminator, `question`/`draft`/`review` preserve the deliberate request-selection flow, and `next` may claim only what the returned graph establishes. Do not force graph use when the next evidence is source body text, an unsupported file, or otherwise outside the index.

The serialized dump is a deterministic function of the source snapshot. Do not add timestamps, unstable iteration order, source bodies, or reconstructable duplicate span fields. `SamchonGraphMemory` restores the compact wire shape and builds its derived indices; the MCP server sends the structured result once rather than duplicating it as a second text payload. An `escape` request on a cold server must not build the graph.

The product currently supports TypeScript, Go, Rust, C++, C, Java, C#, Kotlin, Swift, Scala, Zig, Python, Ruby, PHP, Lua, and Dart. JavaScript is intentionally excluded because arbitrary repositories cannot reliably distinguish handwritten JavaScript from build output or vendored bundles without project-specific provenance.

## Closed Product Decisions

- Do not inline source bodies into graph results.
- Do not hardcode fixture names, repositories, prompts, expected answers, models, token targets, filenames, package names, or tool-call counts.
- Do not add benchmark-only branches, forced first calls, caps, cooldowns, or agent-control tricks that degrade normal coding-agent behavior.
- Do not validate answer quality with free-text word, phrase, regex, or final-response matching. The harness may record numeric observations and traces; humans or a justified trace audit assess answer quality.
- Do not describe ranked selection as complete or exact when it is not. Keep audit and `next` claims no stronger than the server's evidence.
- Do not make the dump depend on wall-clock time, session history, filesystem enumeration order, or repeated serialization of the same evidence.

## Workspace Layout

- `packages/graph/src`: canonical semantic graph, MCP, CLI, and LSP source.
  - `indexer/`: language discovery, LSP and static indexing, session refresh, graph finalization, and resident-source lifecycle.
  - `lsp/`: JSON-RPC language-server client and protocol structures.
  - `operations/`: handle resolution, ranking, query engines, evidence, audits, and `next` decisions.
  - `structures/`, `typings/`: public typed request, result, graph, and language contracts.
  - `mcp/`: resident source wiring and MCP server construction.
  - `viewer/`, `view.ts`: bundled reference viewer and HTTP launcher.
- `packages/graph-sitter/src`: isolated best-effort syntax fallback; it emits raw nodes and edges but does not own the semantic graph or MCP contract.
- `packages/graph/build`: package build helpers, including viewer bundling.
- `tests/test-graph`: deterministic TypeScript end-to-end and regression suite. `src/internal` owns shared fixtures and fake tool processes; `src/features` contains one discovered test per file.
- `tests/experiment`: real-language-server smoke experiments. The GitHub Actions matrix installs each actual server and rejects a static fallback.
- `tests/benchmark`: manual graph-agent benchmark, comparator setup, corpus manifest, trace audit, publication, and deterministic chart rendering.
- `config`: shared strict TypeScript and `@ttsc/lint` policy.
- `.github/workflows`: cross-platform build/test/coverage, release, and real-language-server experiment workflows.
- `assets`: tracked public images and published benchmark charts.

## Generated And Canonical Files

The root `README.md` is canonical. `packages/graph/README.md` is ignored and copied from the root during package build; never edit the package copy directly.

`lib/`, `coverage/`, `.nyc_output/`, package-local `lib/` directories, test bundles, benchmark work directories, experiment work/results, and most benchmark traces/render outputs are generated or ignored. Change their sources or generators instead of editing generated output. Before touching a benchmark result or asset, read the benchmark skill because a small tracked publication surface is intentionally derived from larger local reports.

## Commands

```bash
pnpm install
pnpm build
pnpm test
pnpm coverage
```

Use the narrowest proving command first:

```bash
pnpm --dir packages/graph exec ttsc check -p tsconfig.json
pnpm --filter @samchon/graph-test start -- --include=<test-name-fragment>
pnpm --filter @samchon/graph-experiment start -- --language <language>
pnpm --filter @samchon/graph-benchmark test
pnpm --filter @samchon/graph-benchmark preflight
```

`pnpm test` builds both product packages and the test bundle before running every discovered feature. `pnpm coverage` rebuilds them and enforces 100 percent line, function, and branch coverage over `packages/graph/src` and `packages/graph-sitter/src`, excluding only the viewer surfaces named in the root script. There is no repository-wide `pnpm format` script; do not invent one or assume formatting is a separate validation gate.

`ttsc format` and `ttsc fix` exist as package-local mutating commands, not read-only validation. Do not run either across a dirty worktree unless formatting or automated fixes are explicitly in scope and the affected paths are understood. The existing `security/detect-unsafe-regex` rule is warning-only; compare warnings and investigate newly introduced ones instead of treating the known warning set as an error-free baseline.
