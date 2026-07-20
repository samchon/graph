---
name: review
description: Defines exhaustive solo @samchon/graph Self-Review, unqualified review, and repository-wide issue-discovery rounds. Use for every self-review or unqualified review request and as the default review mode inside an issue campaign. This skill never spawns review agents; use the multi-agent skill only when the user explicitly requests a team, parallel, or multi-agent review or campaign.
---

# Review

## Non-Negotiable Review Law

One reviewer performs every review in this skill from scratch over the entire
declared surface. Do not spawn a subagent, delegate a concern, or load the
discussion skill.

Choose the principled conclusion. Review duration, difficulty, and consequence
surface are reasons to inspect more deeply and verify more carefully, never
reasons to overlook a sound improvement, accept an unsupported claim, or lower
the completion standard.

A complete round must satisfy all four rules:

- **Whole surface:** read every changed file and hunk. For issue discovery,
  audit the entire campaign scope. Never partition by file, package, concern,
  platform, or pass.
- **Consequence surface:** inspect affected code paths, tests, generated
  artifacts, CI, packaging, documentation, experiments, benchmark inputs, and
  consumers. Trace side effects, state transitions, concurrency, platforms,
  boundaries, compatibility, and failure and recovery paths beyond the named
  symptom or diff.
- **Fresh start:** use the current state and repeat the whole inspection.
  Earlier rounds, sampled files, and a recheck of only the latest fix do not
  count as coverage.
- **Unlimited rounds:** whenever the reviewer applies an improvement or accepts
  a meaningful issue candidate, update the work and start another complete
  round. Stop only after a complete round produces nothing that survives
  verification.

## Graph Review Surface

Include the following when relevant:

- LSP, static, and hybrid equivalence; language-specific syntax and fallback
  behavior;
- resident load, refresh, retry, serialization, cache invalidation, diagnostics
  replacement, and child-process closure;
- Windows `.cmd`/path behavior and POSIX executable lookup;
- public TypeScript exports, MCP schemas and descriptions, CLI help and errors,
  README contract text, and package build output;
- operation ranking, exact-fact versus heuristic-selection claims, evidence,
  audit text, and `next` truthfulness;
- 100 percent coverage without test-only branches or unjustified ignore
  directives;
- deterministic fake-server tests versus real-server experiment ownership; and
- benchmark fixture isolation, prompt and commit hashes, comparator fairness,
  raw traces, sample counts, and tracked publication assets.

## Self-Review

Self-Review and an unqualified review request use this solo workflow:

1. Establish the complete change surface, including the pull-request base-to-head
   diff and any uncommitted changes.
2. Perform one complete round under the Non-Negotiable Review Law and Graph
   Review Surface.
3. Reproduce every suspected defect before accepting it.
4. Apply every sound in-scope improvement and run the narrowest verification
   that proves it.
5. If anything changed, restart at step 1 as a fresh full round.
6. Finish only when a complete round finds nothing to improve. Report the final
   clean round and every verification that could not run.

Self-Review does not authorize creating, pushing, updating, or merging a pull
request. If the user separately requests one of those actions, follow the
pull-request skill.

## Solo Issue Discovery Rounds

Use these rounds only through the solo issue-campaign skill.

1. Audit the entire declared campaign scope yourself. Inspect source, tests,
   documentation, CI, packaging, generated artifacts, platform behavior,
   experiments, benchmark validity, upstream or downstream provenance, and open
   and closed issue or pull-request history.
2. Record every raw candidate and its evidence in the campaign knowledge base
   before adjudication. Do not silently discard a suspicion because it looks
   duplicative or inconvenient.
3. Reopen each candidate from primary evidence, reproduce it, verify ownership
   and provenance, and trace its complete consequence surface.
4. Record accept, partial acceptance, rewrite, combine, split, reject, or defer.
   Keep the disposition and reason in the knowledge base so later passes do not
   rediscover a rejected premise as new.
5. Publish only the surviving adjudicated form when the campaign is authorized
   to publish.
6. If any meaningful candidate survives, finish the authorized issue and
   implementation flow, then begin another fresh full-scope round over the
   integrated state.
7. End discovery only when one complete fresh round over the entire scope
   produces no meaningful candidate after fact-checking.

An unresolved accepted issue, external blocker, or incomplete implementation
prevents a successful campaign conclusion. Report it as blocked or active rather
than treating it as a clean round.

## Explicit Multi-Agent Reviews

When the user explicitly asks for a team, parallel, or multi-agent review, load
the [multi-agent skill](../multi-agent/SKILL.md) and its review procedure instead
of this workflow. It inherits the same whole-surface and fresh-round law while
defining independent parallel reviewers and lead adjudication.
