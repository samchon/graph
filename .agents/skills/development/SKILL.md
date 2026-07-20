---
name: development
description: Defines @samchon/graph implementation rules, consequence analysis, testing standards, validation, and change integrity. Use before writing or modifying source, tests, workflows, package wiring, fixtures, generated publications, index algorithms, MCP contracts, or resident-session behavior.
---

# Development

## Forbidden

These approaches are never acceptable:

- **No monkey-patching or hardcoding.** Do not special-case a consumer, fixture, repository, prompt, model, expected answer, or benchmark cell. Fix the general logic.
- **No test-passing-only logic.** Code exists to be correct, not merely to turn a check green. A branch whose only purpose is satisfying one assertion is a defect.
- **No forcing a broken design.** When the same failure returns under patch after patch, stop and repair the owning design or invariant instead of accumulating symptoms.
- **No whack-a-mole.** Treat the reported case as one witness. Find the root cause, cover its positive, negative, and boundary forms, and seal the verified class of failure.

## Work Rules

- Choose the principled course. Time, difficulty, and the breadth of consequences require more careful analysis and validation; they never justify a shortcut, leaving a verified consequence unaddressed, or a weaker acceptance standard.
- Open nearby peers before adding a file, function, public type, operation, test, or fixture. Mirror the established naming, location, export, and error-handling conventions.
- Respect package boundaries. Semantic graph, LSP, MCP, and CLI source lives under `packages/graph/src`; best-effort syntax extraction lives under `packages/graph-sitter/src`; test-only helpers live under `tests/test-graph/src/internal`; real-server provisioning lives under `tests/experiment`; benchmark policy stays under `tests/benchmark`.
- Keep public exports synchronized through the nearest barrel and the root package surface. Public schema changes also require the matching MCP description, README contract excerpt, and compatibility review.
- Follow the normal public-source convention of one export named for its file, with barrels containing re-exports rather than local declarations. Preserve the explicitly tested exceptions instead of generalizing them into a second style.
- Preserve strict TypeScript assumptions, NodeNext module behavior, LF output, and `@ttsc/lint` checks from `config/`.
- Reuse existing utilities and typed structures before creating another abstraction. Add no dependency without an explicit product reason and user authorization.
- Edit the root `README.md`, never the generated `packages/graph/README.md` copy.
- Keep diffs small and reviewable. Do not reformat or rewrite unrelated user changes in a dirty worktree.

## Consequence Analysis

Before changing behavior, trace the cause through the relevant surfaces:

- one-shot `dump`, long-lived MCP, viewer, and TypeScript API callers;
- LSP, static, and hybrid indexing lanes;
- initial load, incremental refresh, failed load, retry, shutdown, and process cleanup;
- resident serialization, cache invalidation, file creation/change/deletion, diagnostics replacement, and session ownership;
- every supported language, shared-server cases such as C/C++, and language-specific preparation such as CMake or Dart packages;
- Windows command shims and path handling as well as POSIX lookup and signals;
- operation ranking, downstream flows, nearby nodes, tests, evidence, audits, and `next` decisions;
- public exports, README contract text, CLI help, MCP schema, experiments, benchmarks, and release packaging.

Fix the verified class without broadening the user's product goal.

## Testing

Each deterministic feature test lives in `tests/test-graph/src/features/test_<snake_case>.ts` and exports exactly one matching `test_<snake_case>` function. The dynamic runner discovers that prefix and rejects files with zero or multiple test exports.

Use `@nestia/e2e`'s `TestValidator` and the shared fixtures in `tests/test-graph/src/internal`. Extend a nearby fixture or fake process rather than creating an unrelated harness. Keep real language-server installation and network-heavy project smoke tests in `tests/experiment`; the deterministic suite must not depend on globally installed servers or network access.

Coverage is a specification, not a reason for artificial branches. The root `pnpm coverage` command enforces 100 percent line, function, and branch coverage. Use `c8 ignore` only for a genuinely untestable platform/process boundary and keep the ignored span as narrow as possible.

A regression test must fail for the reported behavior before the fix and pass after it. Cover:

- the transformation or state transition that must occur;
- a negative twin one property away where it must not occur;
- empty, singleton, exact-limit, ambiguous-name, missing-server, and recovery boundaries that apply; and
- both source-of-truth lanes when the invariant is shared by LSP and static indexing.

## Validation

Run the narrowest command that proves the change first, then the broader gates required by its consequence surface. Report every command that could not run.

- **Focused TypeScript change:** `pnpm --dir packages/graph exec ttsc check -p tsconfig.json`. This runs type analysis and error-level lint rules without emitting files; compare warning output so new warning-level findings are not hidden among the known regex warnings.
- **Focused regression:** `pnpm --filter @samchon/graph-test start -- --include=<fragment>`.
- **Package or shared behavior:** `pnpm build` and `pnpm test`.
- **Source behavior or coverage-sensitive branch:** `pnpm coverage`.
- **Language-server behavior:** focused fake-server tests first, then `pnpm --filter @samchon/graph-experiment start -- --language <language>` when that real server is available. The full real-server matrix belongs to `.github/workflows/experiment.yml`.
- **Benchmark harness logic:** zero-spend benchmark tests and preflight before any paid run; follow the benchmark skill.

Verification shape depends on the change type:

- **Bug fix:** name the failing case and expected behavior; run a reproduction that distinguishes before from after.
- **Feature:** name the observable contract and exercise it through the public API, CLI, or MCP boundary.
- **Refactor:** name what must remain unchanged and rely on behavior-locking tests before cleanup edits.
- **Review:** report concrete defects, risks, missing tests, or regressions with evidence.

## Change Integrity

Treat tests, fixtures, benchmark prompts and manifests, CI workflows, package wiring, dependencies, public schemas, audit text, generated chart inputs, and the 100 percent coverage gate as specification. Changing them requires an explicit user request or a verified product reason, and the final report must call it out.

Package-local `ttsc format` and `ttsc fix` mutate every selected source file. They are implementation actions, not validation commands; never run them casually in a dirty worktree.

For ports, migrations, or broad rewrites, preserve the existing algorithm and public behavior in reviewable slices. Inspect the diff and generated/public surface before trusting a green test run.
