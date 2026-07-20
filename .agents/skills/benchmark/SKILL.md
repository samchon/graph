---
name: benchmark
description: Defines @samchon/graph benchmark selection, external fixture isolation, comparator fairness, trace and result integrity, and publication safeguards. Use before running or modifying deterministic benchmark checks, corpus manifests, paid agent A/B runs, cold-index measurements, trace audits, result JSON, or benchmark chart assets; paid runs and global tool setup require explicit authorization.
---

# Benchmark

This repository has one benchmark system under `tests/benchmark`. Read [graph.md](graph.md) in full before running or changing its orchestrator, prompts, fixtures, comparator setup, trace audit, publication data, or rendered assets.

## Measurement Integrity

- Measure the real product. Do not add benchmark-only branches, fixture-name checks, expected-answer checks, monkey patches, prompt-specific ranking, or agent restrictions that would be wrong for an unmeasured repository.
- Give every comparator the setup prescribed by its own documentation and record setup time. Deliberately underconfiguring another tool invalidates the comparison.
- Preserve the workload, pinned commit, normalized prompt hash, harness, model version, reasoning effort, and requested sample count. A cheaper result obtained by indexing, reading, or answering less work is not an optimization.
- Keep baseline and graph utterances equivalent. Tool discovery belongs to the isolated harness/MCP setup, not a hidden graph-specific suffix in the user prompt.
- Treat a surprising result as evidence that the change is not understood. Inspect raw reports, answers, and traces before accepting, explaining away, publishing, or patching around it.
- Never validate answer quality through expected words, regexes, or final-response text. Structural validity and tool behavior can be checked mechanically; semantic answer quality requires evidence-based trace review.

## Fixture Integrity

The corpus pins external repositories by full commit and clones them beside this repository under `../graph-benchmark-work`. Keeping measured checkouts outside the repository prevents Codex and Claude Code from inheriting this repository's `AGENTS.md` or `CLAUDE.md` through parent-directory discovery.

Do not move fixtures under `tests/benchmark/.work`. Do not edit a prepared clone as the durable source of a fixture change; the next setup resets it to the pinned commit. Update the authoritative corpus or upstream fixture only when the task explicitly calls for it, then regenerate and verify the manifest through the repository script.

## Cleanup

At the end of an authorized benchmark assignment, remove every completed worktree and disposable Go asset that the assignment created. First verify the absolute path, that no process uses it, and that raw reports, traces, and other retained evidence live elsewhere. Only remove workspace-local temporary server binaries, Go work or cache directories, extracted tool directories, or benchmark setup directories inside the completed worktree or an explicit assignment-owned temporary root. Never delete global `GOCACHE`, `GOMODCACHE`, or a shared corpus fixture as benchmark cleanup.

## Reporting And Publication

Preserve raw samples, exact model versions, answers, trace paths, setup time, tool calls, source touches, shell calls, durations, and failures in the report. A spent-token failure is evidence, not a sample to erase. Only the harness's explicitly classified zero-token infrastructure or capacity failures may be retried away.

Do not publish `tests/benchmark/results/graph.json` or replace tracked `assets/benchmark-*.svg` and `.png` files from a partial, unaudited, concurrent, or locally contaminated run. Report results in the final response when publication is not authorized.
