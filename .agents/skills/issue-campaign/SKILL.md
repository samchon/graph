---
name: issue-campaign
description: Defines repository-wide issue discovery, lead-vetted issue publication, dependency-batched implementation, ordinary CI verification, and worktree cleanup for @samchon/graph. Use when the user asks for a broad audit, many issue candidates, or a repeated issue-to-pull-request campaign; do not use for one already-defined issue, an ordinary pull request, or a review with no campaign scope.
---

# Issue Campaign

An issue campaign is a repeatable sequence of exhaustive discovery, issue publication, implementation pull requests, and final reconciliation. The user's requested phase boundary controls how far to proceed. An audit-only request does not authorize issue publication, branch pushes, pull requests, merges, paid benchmarks, releases, or global tool installation.

Read the project, development, and review skills before starting, and require every discovery-agent brief to do the same. Use the review skill's Issue Discovery Rounds; issue discovery is independent review, not discussion.

## Campaign Knowledge Base

Create `.wiki/<campaign>/` with a short filesystem-safe name. Preserve an existing campaign directory and reconcile it rather than deleting it or assuming a blank slate.

Keep concise, current Markdown documents for:

- repository provenance, architecture, and ownership boundaries;
- experiments, reproductions, dogfooding, benchmark traces, and related issue or pull-request history;
- candidates, evidence, dependencies, and lead disposition; and
- implementation pull requests, worktrees, local verification, CI state, and deferred external checks when those phases apply.

The knowledge base supports the campaign but is not the final issue body. A published issue must stand alone without access to `.wiki`.

## Discover Issues

Run the review skill's Issue Discovery Rounds over the entire declared campaign scope. Every reviewer independently audits the whole surface in every round. Never divide it by package, file, concern, platform, language, candidate class, agent, or round.

Source is only one evidence layer. Exercise real workflows and inspect relevant upstream behavior, history, generated artifacts, public schemas, LSP/static parity, consumers, fixtures, CI, experiments, benchmark traces, and documentation.

Treat the development skill's **Forbidden** section as a retrospective audit contract, not only a rule for future changes. In every complete round, inspect the current implementation and history for violations, including code that predates the campaign or passes every test. Prove a violation from purpose, control flow, consequence, and history; resemblance or stylistic preference is not evidence.

Discovery ends only when a complete round from every reviewer produces no meaningful candidate that survives lead verification.

## Vet And Publish Issues

The lead owns every publication decision. For each candidate:

1. Reopen its evidence and reproduce the behavior.
2. Verify ownership, provenance, and any classification under the development skill's **Forbidden** section.
3. Trace the full consequence surface across product lanes, languages, platforms, public contracts, and tests.
4. Compare open and closed issues and pull requests.
5. Record accept, partial acceptance, rewrite, combine, split, reject, or defer with the supporting evidence.

Publish only the adjudicated form and only with user authorization.

### Self-Contained Issue Body

Write enough context for a fresh coding agent to begin from the issue alone. Cover these sections when they apply:

- **Problem:** current and expected behavior, impact, and affected users.
- **Evidence:** exact reproduction, outputs or artifacts, stable symbols, verified root cause, ownership, and provenance. Line numbers are navigation, not proof.
- **Consequence surface:** affected API/CLI/MCP consumers, LSP/static/hybrid lanes, resident states, languages, platforms, compatibility and failure paths, plus the complete case matrix for the cause.
- **Approach:** the invariant and architectural owner without prescribing an unverified implementation.
- **Acceptance and verification:** positive, negative, boundary, recovery, and regression outcomes with narrow and broader proving commands.
- **Coordination:** dependencies, safe parallelism, exclusions, experiment or benchmark requirements, migration concerns, and related accepted or rejected work.

Use tables for repeated case mappings. Read the rendered issue back and keep its body as the operative handoff; use comments for chronology.

## Develop And Repeat The Campaign

Read [development.md](development.md) in full when the user authorizes implementation pull requests or ends a campaign that entered implementation. It owns dependency batching, claim pull requests, implementation waves, ordinary check handling, worktree cleanup, renewed discovery, and final reconciliation.

An audit or issue-publication-only campaign does not load the implementation procedure or mutate repository, Actions, benchmark, or release state.
