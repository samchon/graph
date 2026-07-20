# Campaign Development

Read this document in full when the user authorizes implementation pull requests or ends a campaign that entered implementation. Also read the repository development, pull-request, and review skills before acting.

## Flow

- [Plan And Claim A Pull Request Wave](#plan-and-claim-a-pull-request-wave)
- [Keep Working While Commands Run](#keep-working-while-commands-run)
- [Implement And Revalidate A Batch](#implement-and-revalidate-a-batch)
- [Remove Every Finished Worktree](#remove-every-finished-worktree)
- [Repeat A Campaign Cycle](#repeat-a-campaign-cycle)
- [Final Reconciliation](#final-reconciliation)

## Plan And Claim A Pull Request Wave

Only an admitted issue can enter implementation. The lead first reopens the issue evidence, reproduces the behavior, verifies ownership and the full consequence surface, compares related open and closed work, and records an accept, partial acceptance, rewrite, combine, split, reject, or defer disposition. A rejected or deferred issue has no worktree or claim pull request.

Build the issue dependency DAG before assigning implementation. Form cohesive batches instead of creating one worktree per issue.

- Group dependency-ready issues when their change surfaces and verification are compatible.
- Assign one batch to one agent, worktree, branch, and pull request.
- Split jointly implementable issues only for a concrete dependency, ownership, atomicity, or validation reason. Record the reason in the campaign knowledge base.
- Immediately before claiming a batch, check for an overlapping implementation pull request or branch.

When remote work is authorized, the assigned agent claims a batch before implementation:

1. Create an isolated worktree and topic branch from the intended target.
2. Create the smallest repository-valid, implementation-free claim commit and push the branch.
3. Immediately open a draft pull request that names the complete batch and links every included issue.
4. Mark implementation and verification as pending, then record the batch, worktree, branch, issues, pull request, and initial check state in `.wiki/<campaign>/`.
5. Start `pnpm install` asynchronously in the worktree, then begin source inspection, consequence analysis, and test design immediately.

The draft reserves the whole batch. Do not create claim branches or pull requests during an audit-only or issue-publication-only phase.

## Keep Working While Commands Run

Start every long local command asynchronously and continue with work that does not depend on its result. `pnpm install`, package builds, language-server or toolchain downloads, and test suites are background work. Watching a CLI process, repeatedly polling it without a decision to make, or reserving an agent solely to wait is not campaign work.

Maintain a compact command record containing the command, worktree, source snapshot, start time, dependent decision, and final result. Check a running command when it exits, at a genuine decision boundary, or before merge. Do not use sleep loops or foreground waits merely to learn that it is still running.

While installation runs, read the admitted issues and nearby implementation, map the consequence surface, and write the implementation and regression tests. Once a stable source-and-test snapshot is committed and pushed, launch the narrowest proving tests and begin solo Self-Review at once. A test process may run during review because it does not change the snapshot. Start independent checks together instead of serially waiting for each one to finish.

Ordinary pull-request checks remain required evidence. Monitor them without making an implementation agent idle: continue the current snapshot's Self-Review, documentation audit, generated-surface inspection, or other safe in-scope work until a result creates a decision.

Some boundaries remain strict:

- **A Self-Review round must not race a source change.** Freeze and commit the snapshot before opening the round. If review or a command result requires a change, commit the correction and restart a fresh complete round over the new snapshot.
- **A merge must not precede its evidence.** Required local results and ordinary checks must be final before merge.
- **A failed command blocks only dependent decisions.** Continue safe independent work while repairing or awaiting it.

Report any command still running, its dependent decision, and its last observed state when handing work off. Waiting is justified only when the next decision genuinely depends on the completed result and no safe independent work remains.

## Implement And Revalidate A Batch

Analyze the full consequence and case surface across every issue in the batch. Follow the development skill for regression tests, implementation, documentation, generated artifacts, and narrow-to-broad verification.

A batch progresses through one-way states: admitted, reserved, active, snapshotted, reviewed, verified, then resolved. Active work begins while installation runs. A snapshot is the committed implementation and test program, not the completion of its background commands. Review starts on that immutable snapshot while narrow tests run. Verification consumes every required local and CI result, applies any correction through a new snapshot and fresh review, and only then permits resolution.

An implementation agent may find that an issue is false or too broad. The lead must independently validate that conclusion before changing campaign state:

- For a narrowed issue, record the evidence on the issue and pull-request thread, then update the batch scope.
- For a confirmed-invalid issue, record the evidence and close the issue only when remote issue mutation is authorized.
- If no issue remains in the batch, close the claim pull request instead of leaving an orphan reservation.

Commit and push a coherent increment as soon as its source and test program are complete. Do not hold a completed snapshot locally while waiting for tests already running. After every push, follow the pull-request skill and monitor every relevant ordinary check while continuing safe work on the immutable snapshot. Do not cancel repository Actions or exact-SHA runs as a campaign shortcut; this repository's cross-platform test and path-sensitive experiment matrices are evidence.

Paid agent benchmarks, releases, package publication, global language-server installation, and destructive fixture resets remain separate authorization boundaries. Record them as pending when the batch needs evidence that cannot safely run in the current environment.

Before merge, complete solo Self-Review. A pending local test or ordinary check never delays the start of that review, but its final result is required before merge. Under an ordinary campaign, merge only with explicit user authorization. Under a standing mandate to carry the campaign through merge, merge once implementation, Self-Review, local verification, and required checks pass.

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
