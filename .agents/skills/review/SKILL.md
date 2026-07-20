---
name: review
description: Defines exhaustive solo and team review workflows for @samchon/graph changes and issue discovery. Use when reviewing or self-reviewing a change or pull request, running a Review Cycle or Research Review Round, or conducting repository-wide issue-discovery rounds. Self-Review and unqualified review requests are always solo; review agents work independently rather than discussing.
---

# Review

## Non-Negotiable Review Law

Every review mode uses the same unit of work: one reviewer performs one complete, from-scratch review of the entire declared surface. A team adds independent complete reviews; it never divides one review among agents.

Choose the principled conclusion. Review duration, difficulty, and consequence surface are reasons to inspect more deeply and verify more carefully, never reasons to overlook a sound improvement, accept an unsupported claim, or lower the completion standard.

A complete round must satisfy all four rules:

- **Whole surface:** read every changed file and hunk. For issue discovery, audit the entire campaign scope. Never partition by file, package, concern, platform, agent, or round, and never substitute another reviewer's coverage.
- **Consequence surface:** inspect affected code paths, tests, generated artifacts, CI, packaging, documentation, experiments, benchmark inputs, and consumers. Trace side effects, state transitions, concurrency, platforms, boundaries, compatibility, and failure and recovery paths beyond the named symptom or diff.
- **Fresh start:** use the current state and repeat the whole inspection. Earlier rounds, sampled files, and a recheck of only the latest fix do not count as coverage.
- **Unlimited rounds:** whenever a solo reviewer applies an improvement, or a lead accepts an improvement or meaningful issue candidate, update the work and start another complete round. Stop only after a complete round produces nothing that survives verification.

## Graph Review Surface

Include the following when relevant:

- LSP, static, and hybrid equivalence; language-specific syntax and fallback behavior;
- resident load, refresh, retry, serialization, cache invalidation, diagnostics replacement, and child-process closure;
- Windows `.cmd`/path behavior and POSIX executable lookup;
- public TypeScript exports, MCP schemas and descriptions, CLI help and errors, README contract text, and package build output;
- operation ranking, exact-fact versus heuristic-selection claims, evidence, audit text, and `next` truthfulness;
- 100 percent coverage without test-only branches or unjustified ignore directives;
- deterministic fake-server tests versus real-server experiment ownership;
- benchmark fixture isolation, prompt and commit hashes, comparator fairness, raw traces, sample counts, and tracked publication assets.

## Self-Review

Self-Review is strictly solo. The author does not spawn subagents, form a team, or load the discussion skill. An ordinary review request also defaults to this solo workflow unless the user explicitly asks for a team.

1. Establish the complete change surface, including the pull-request base-to-head diff and all uncommitted changes.
2. Perform one complete round under the Non-Negotiable Review Law and Graph Review Surface.
3. Apply every sound in-scope improvement and run the narrowest verification that proves it.
4. If anything changed, restart at step 1 as a fresh full round.
5. Finish only when a complete round finds nothing to improve. Report the final clean round and any verification that could not run.

Self-Review does not authorize creating, pushing, updating, or merging a pull request. If the user separately requests one of those actions, follow the pull-request skill.

## Team Review Cycle

Use Review Cycle only when the user explicitly asks for a team or multi-agent review.

1. Form the largest practical team within the available concurrency. Give every reviewer the same complete surface and require an independent complete round. Different analytical lenses are welcome; divided coverage is forbidden.
2. Reviewers submit independent findings to the lead. They do not negotiate consensus or use discussion transcripts.
3. The lead independently reproduces and validates every proposal against the repository. Apply only technically sound, in-scope improvements; rewrite, combine, partially accept, or reject proposals as the evidence warrants.
4. If the lead applies any improvement, replace or reset the reviewers and begin another complete cycle. Stop only after a full cycle yields no accepted improvement.

## Research Review Round

Use Research Review Round when a team review needs external or cross-repository evidence before proposing changes.

Each reviewer independently examines the complete change surface and every relevant primary source or sibling repository. Reviewers submit evidence-backed proposals directly to the lead without a discussion phase.

The lead validates every proposal and applies the Team Review Cycle stop rule. External research adds evidence; it does not relax full-surface coverage.

## Issue Discovery Rounds

Use issue discovery only as part of the issue-campaign skill.

1. Form the largest practical review team and apply the briefing rules below. Give every reviewer the entire campaign scope and require the issue-campaign, project, development, and review skills in the brief.
2. Every reviewer independently audits source, tests, documentation, CI, packaging, generated artifacts, platform behavior, experiments, benchmark validity, upstream or downstream provenance, and open and closed issue or pull-request history. Audit the current implementation and history against the development skill's **Forbidden** section. Never divide the repository by package, file, concern, agent, or round.
3. Each reviewer submits independent evidence-backed candidates without discussion or a shared list.
4. The lead reopens the evidence, reproduces the behavior, checks ownership and provenance, and compares existing issues and pull requests. Reject, rewrite, combine, partially accept, or return a proposal as the evidence requires.
5. Record only surviving candidates in the campaign knowledge base. If any meaningful candidate survives, begin another complete discovery round.
6. Stop only when a complete round from every reviewer produces no meaningful candidate that survives lead verification.

## Briefing Review Agents

Review agents may start without conversation history or loaded repository instructions. Give each a self-contained brief containing:

- the objective and complete declared surface;
- constraints and evidence locations;
- the required output format; and
- the exact repository instructions and skills to read.

State facts and constraints, not a preferred conclusion. Reviewers execute the brief directly and do not re-delegate unless explicitly asked.
