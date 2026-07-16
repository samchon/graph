# Campaign Development

Read this document in full when the user authorizes implementation pull requests or ends a campaign that entered implementation. Also read the repository development, pull-request, and review skills before acting.

## Plan And Claim A Pull Request Wave

Build the issue dependency DAG before assigning implementation. Form cohesive batches instead of creating one worktree per issue.

- Group dependency-ready issues when their change surfaces and verification are compatible.
- Assign one batch to one agent, worktree, branch, and pull request.
- Split jointly implementable issues only for a concrete dependency, ownership, atomicity, or validation reason. Record the reason in the campaign knowledge base.
- Immediately before claiming a batch, check for an overlapping implementation pull request or branch.

When remote work is authorized, the assigned agent claims a batch before implementation:

1. Create an isolated worktree and topic branch from the intended target.
2. Open a draft pull request that names the complete batch and links every included issue. If the host requires a pushed commit first, use the smallest repository-valid claim commit.
3. Mark implementation and verification as pending.
4. Record the batch, worktree, branch, issues, pull request, and initial check state in `.wiki/<campaign>/`.

The draft reserves the whole batch. Do not create claim branches or pull requests during an audit-only or issue-publication-only phase.

## Implement And Revalidate A Batch

Analyze the full consequence and case surface across every issue in the batch. Follow the development skill for regression tests, implementation, documentation, generated artifacts, and narrow-to-broad verification.

An implementation agent may find that an issue is false or too broad. The lead must independently validate that conclusion before changing campaign state:

- For a narrowed issue, record the evidence on the issue and pull-request thread, then update the batch scope.
- For a confirmed-invalid issue, record the evidence and close the issue only when remote issue mutation is authorized.
- If no issue remains in the batch, close the claim pull request instead of leaving an orphan reservation.

Commit and push coherent increments to the claimed branch. After every push, follow the pull-request skill and wait for every relevant ordinary check. Do not cancel repository Actions or exact-SHA runs as a campaign shortcut; this repository's cross-platform test and path-sensitive experiment matrices are evidence.

Paid agent benchmarks, releases, package publication, global language-server installation, and destructive fixture resets remain separate authorization boundaries. Record them as pending when the batch needs evidence that cannot safely run in the current environment.

Before merge, complete solo Self-Review. Under an ordinary campaign, merge only with explicit user authorization. Under a standing mandate to carry the campaign through merge, merge once implementation, Self-Review, local verification, and required checks pass.

## Remove Every Finished Worktree

Worktree removal is part of finishing an assignment.

After a pull request merges:

1. Verify the host records it as merged into the intended target.
2. Confirm the worktree has no unpushed or uncommitted work worth preserving.
3. Resolve the absolute worktree path and verify it is the campaign-created path.
4. Remove the worktree, including disposable ignored build artifacts.
5. Verify the directory is gone, prune worktree metadata, and delete the local topic branch.
6. Confirm `git worktree list --porcelain` contains no record of the removed path.

If an assignment ends without a merge, first record retained evidence and obtain any authority needed to discard the remaining contents. Never force-remove a worktree whose ownership or unpublished contents are uncertain.

## Repeat A Campaign Cycle

Report the wave after every surviving issue is covered by its assigned batch pull request.

When the user requests another discovery cycle, return to the parent skill's Discover Issues phase and start new full rounds over the entire campaign scope. Earlier rounds are not current coverage, and implementation does not itself authorize another publication or merge phase.

## Final Reconciliation

Run this phase only after the user ends the campaign, every campaign pull request is resolved, and every campaign worktree is either removed or explicitly retained.

1. Reconcile the knowledge base against actual issue, branch, pull-request, merge, check, and worktree state.
2. In a clean checkout of the integrated target, run `pnpm build`, `pnpm test`, and `pnpm coverage`.
3. Run affected deterministic benchmark tests and any authorized experiment or paid-benchmark gates. Record unavailable external checks rather than pretending they passed.
4. Confirm the root README, public application contract, language claims, manifest-derived files, and tracked benchmark assets match the integrated source.
5. Confirm no campaign-created branch, worktree, temporary report, generated package README, or ignored build artifact remains unless the knowledge base explicitly records why it is retained.
6. Report resolved issues, merged pull requests, exact verification, deferred risks, and retained artifacts.

There is no repository-wide formatter or formatter cleanup pull request. Do not invent a `pnpm format` phase for campaign cleanup.
