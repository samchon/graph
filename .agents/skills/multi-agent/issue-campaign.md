# Multi-Agent Issue Campaign

Read this document only through the multi-agent skill for an explicitly parallel
issue campaign. Read the base issue-campaign, project, development,
pull-request, review, and [multi-agent review](review.md) procedures before
acting.

The base issue-campaign skill owns authorization, the knowledge base, candidate
adjudication, self-contained issue bodies, and the clean full-scope completion
gate. This document overrides only discovery and implementation topology.

## Select The Parallel Boundary

A multi-agent issue campaign parallelizes both discovery and implementation by
default.

Switch to parallel discovery with solo implementation only when the user
explicitly requests that combination. In that mode:

1. Run Parallel Discovery and let the lead complete candidate adjudication and
   authorized publication.
2. Stop every discovery agent before implementation begins.
3. Read the base issue campaign's [solo development procedure](../issue-campaign/development.md).
4. Put every implementation-ready issue into its one empty-claim pull request,
   use the current checkout without a worktree, validate through ordinary CI,
   and complete solo Self-Review while CI runs.
5. Apply that procedure's implementation, CI, merge, branch cleanup, and
   temporary-asset rules, but return here for the next parallel discovery round
   instead of switching to solo discovery.

Do not infer solo implementation from quota concerns, a small issue count, or
the fact that the lead performs publication. Only the user's explicit phase
boundary selects it.

## Parallel Discovery

Use [review.md](review.md)'s Parallel Issue Discovery Rounds. Every discovery
agent audits the whole declared scope independently. The lead alone fact-checks
and publishes.

Pool raw candidates in `.wiki`, then reproduce and combine, split, rewrite,
reject, or defer them before publication. Parallel discovery changes evidence
breadth, not publication authority.

## Build Coarse Implementation Batches

When implementation is also parallel, recompute the published-issue DAG before
every wave. Form the smallest number of maximal cohesive batches that dependency
readiness and ownership permit.

Group issues when they are ready on the same frontier, share an architectural
owner or root invariant, overlap in consequence surface, use mostly the same
verification, and remain understandable and reversible as one diff. Split only
for a named dependency, external blocker, repository or target-branch boundary,
independent release contract, incompatible verification owner, destructive file
overlap, or lost issue-level attribution.

Topic, label, package proximity, reporter, and issue count do not justify a
split. Record the original issue count, final pull-request count, DAG edges,
grouping reasons, split reasons, owned files, and verification lanes in `.wiki`
before opening claims.

Treat every active claim pull request as a fixed batch. Do not add issues,
transfer issues between active claims, combine active branches, or repurpose a
claim. Re-cut an active batch only when correctness, overlap, or invalidated
evidence requires a lead decision.

Open only as many implementation agents as there are immediately executable,
non-overlapping batches.

## Claim And Implement Parallel Batches

For each immediately executable batch:

1. Create one isolated worktree and topic branch.
2. Create an implementation-free commit with `git commit --allow-empty`.
3. Push and open a draft pull request linking every batch issue and stating its
   owned files.
4. Record the batch, worktree, branch, issues, pull request, head SHA, and
   assignment-created temporary assets in `.wiki`.
5. Implement the full consequence surface and its positive, negative, boundary,
   recovery, and regression coverage.
6. Run the graph development skill's narrow-to-broad local validation, commit,
   and push coherent increments.
7. Freeze the head and complete solo Self-Review. If code changes, rerun the
   necessary local gates and restart the full review.
8. Let the lead independently verify issue fit, dispositions, evidence, and
   batch scope.
9. Repair every red ordinary CI lane in the same pull request, whether or not
   the campaign caused it. Commit, push, wait for the new checks, and repeat
   solo Self-Review over the new head.
10. Merge only with user authorization after required checks and solo
    Self-Review are clean on the same head.

Start long local commands asynchronously and continue useful independent work.
Do not reserve an agent solely to watch installation, build, test, CI, or a
language-server experiment.

When batches overlap unexpectedly, stop the later mutation, report the exact
file and invariant conflict, and let the lead serialize or re-cut the work.
Agents never edit another batch's owned files.

## Integrated Cleanup

After every parallel implementation batch merges:

1. Verify the host records its merge into the intended target.
2. Confirm the worktree has no unpushed or uncommitted work worth preserving.
3. Resolve the absolute campaign-created path, remove its worktree and
   disposable ignored artifacts, verify its directory is gone, prune worktree
   metadata, and delete the local topic branch.
4. Remove only assignment-owned external temporary assets after confirming no
   live process needs them and retained evidence lives elsewhere.
5. Confirm `git worktree list --porcelain` contains no removed worktree path.

Never remove a global `GOCACHE`, `GOMODCACHE`, installed Go toolchain, or shared
fixture checkout as batch cleanup.

After all batches resolve and clean up, return to the base issue campaign's
fresh full-scope discovery round.

## Completion

The campaign succeeds only when every parallel discovery reviewer completes the
whole scope, no meaningful candidate survives lead verification, no accepted
issue remains unresolved, and every campaign worktree and assignment-owned
temporary asset is removed. Report an external blocker as blocked, not complete.
