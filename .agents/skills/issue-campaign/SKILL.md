---
name: issue-campaign
description: Defines the default solo @samchon/graph repository-wide issue campaign: exhaustive discovery, lead-vetted issue publication, one integrated implementation pull request per cycle, CI repair, solo Self-Review, cleanup, and renewed discovery. Use for broad audits, many issue candidates, or repeated issue-to-pull-request campaigns unless the user explicitly requests parallel or multi-agent execution; do not use for one already-defined issue, an ordinary pull request, or a review with no campaign scope.
---

# Issue Campaign

An issue campaign is a repeatable solo sequence of exhaustive discovery, issue
publication, one integrated implementation pull request, and renewed discovery.
The main agent owns every phase and spawns no subagent other than the read-only
commit early-warning pass that
[development.md](development.md#implement-and-write-tests) defines.

Use the [multi-agent skill](../multi-agent/SKILL.md) and its issue-campaign
procedure instead only when the user explicitly asks for a parallel or
multi-agent issue campaign.

The user's requested phase boundary controls how far to proceed. An audit-only
request does not authorize issue publication, branch pushes, pull requests,
merges, paid benchmarks, releases, or global tool installation.

Choose the principled course throughout the campaign. Its scale, duration, and
consequence surface require stronger evidence, deeper consequence analysis, and
complete verification; they never justify accepting an unverified candidate, a
shortcut, or a weaker implementation or review standard.

Read the project and review skills before starting. Use the review skill's Solo
Issue Discovery Rounds. Read [development.md](development.md) in full only when
the user authorizes implementation pull requests or ends a campaign that
entered implementation.

## Campaign Knowledge Base

Create `.wiki/<campaign>/` with a short filesystem-safe name. Preserve an
existing campaign directory and reconcile it rather than deleting it or assuming
a blank slate.

Keep concise, current Markdown documents for:

- repository provenance, architecture, and ownership boundaries;
- experiments, reproductions, dogfooding, benchmark traces, and related issue
  or pull-request history;
- every raw candidate, its evidence, dependencies, and final disposition;
- candidate combinations, splits, rejections, and deferrals with their
  supporting evidence; and
- the published-issue DAG, one cycle pull request, CI and Self-Review
  iterations, external checks, temporary assets, and cleanup state.

Record raw candidates before fact-checking. The knowledge base is the durable
place to collect overlapping observations, then combine, split, rewrite,
reject, or defer them without losing why.

The knowledge base supports the campaign but is not the final issue body. A
published issue must stand alone without access to `.wiki`.

## Discover Issues

Perform one complete Solo Issue Discovery Round over the entire declared
campaign scope. Source is only one evidence layer. Exercise real workflows and
inspect relevant upstream behavior, history, generated artifacts, public
schemas, LSP/static parity, consumers, fixtures, CI, experiments, benchmark
traces, and documentation.

Treat the development skill's **Forbidden** section as a retrospective audit
contract, not only a rule for future changes. In every complete round, inspect
the current implementation and history for violations, including code that
predates the campaign or passes every test. Prove a violation from purpose,
control flow, consequence, and history; resemblance or stylistic preference is
not evidence.

Do not stop after finding enough work for a pull request. Complete the entire
scope, adjudicate the full candidate pool, and publish only surviving issues
when authorized.

After the cycle pull request merges, begin a fresh full-scope round against the
integrated repository. Earlier rounds are not coverage. The campaign ends only
when a complete fresh round produces no meaningful candidate after fact-checking
and no accepted issue remains unresolved.

## Vet And Publish Issues

The same main agent owns every publication decision. For each candidate:

1. Reopen its evidence and reproduce the behavior.
2. Verify ownership, provenance, and any classification under the development
   skill's **Forbidden** section.
3. Trace the full consequence surface across product lanes, languages,
   platforms, public contracts, and tests.
4. Compare open and closed issues and pull requests.
5. Record accept, partial acceptance, rewrite, combine, split, reject, or defer
   with the supporting evidence.

Publish only the adjudicated form and only with user authorization.

### Self-Contained Issue Body

Write enough context for a fresh coding agent to begin from the issue alone.
Cover these sections when they apply:

- **Problem:** current and expected behavior, impact, and affected users.
- **Evidence:** exact reproduction, outputs or artifacts, stable symbols,
  verified root cause, ownership, and provenance. Line numbers are navigation,
  not proof.
- **Consequence surface:** affected API/CLI/MCP consumers, LSP/static/hybrid
  lanes, resident states, languages, platforms, compatibility and failure
  paths, plus the complete case matrix for the cause.
- **Approach:** the invariant and architectural owner without prescribing an
  unverified implementation.
- **Acceptance and verification:** positive, negative, boundary, recovery, and
  regression outcomes with narrow and broader proving commands.
- **Coordination:** dependencies, exclusions, experiment or benchmark
  requirements, migration concerns, and related accepted or rejected work.

Use tables for repeated case mappings. Read the rendered issue back and keep its
body as the operative handoff; use comments for chronology.

## Develop And Repeat The Campaign

The [solo development procedure](development.md) owns the one-PR cycle, empty
claim, internal DAG order, test authoring, ordinary CI, solo Self-Review,
red-CI repair, merge, branch and temporary-asset cleanup, and renewed discovery.

An audit or issue-publication-only campaign does not load the development
procedure or mutate repository, Actions, benchmark, or release state.
