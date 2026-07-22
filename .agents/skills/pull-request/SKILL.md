---
name: pull-request
description: Defines @samchon/graph branch, commit, pull-request, check, and merge workflows. Use when the user explicitly asks to open, submit, update, or merge a pull request, or when a standing autonomous mandate authorizes end-to-end delivery; never open, push, update, or merge on unprompted initiative.
---

# Pull Request Submission

Act on this skill only when the user explicitly requests the corresponding remote action, or when a standing autonomous mandate authorizes it. Permission to edit locally is not permission to push or open a pull request, and permission to open or update is not permission to merge. A mandate to carry work through merge authorizes the named steps, but every verification and review gate still applies.

## Branch From The Target

Branch from the pull-request target (`master` unless stated otherwise); never commit or push directly to the target. Name the branch for the merged outcome and follow the nearest established repository convention.

For solo work, do not create a clone or worktree to escape unrelated or
protected changes. Never stash, delete, overwrite, or mix another user's dirty
state; preserve it and obtain direction when the current checkout cannot safely
host the requested branch. Only the explicit multi-agent workflow creates an
isolated worktree for a parallel implementation batch.

## Commit Logical Units

Use one commit per coherent decision when the diff is large. Write an intent-first subject that explains why the change exists and follow any active repository or session commit protocol. When Lore trailers are required, record constraints, rejected alternatives, confidence, scope risk, exact tests, and known gaps honestly.

Run the validation required by the development skill. This repository has no `pnpm format` script; do not invent a formatter gate. Stage explicit paths in a mixed worktree and never include unrelated user changes silently.

## Write The Pull Request

Write the body at open as the historical intent statement. Include the intent, scope, consequence surface, deferred items, and exact local verification. State skipped checks, unavailable language servers, unrun paid benchmarks, and external-toolchain gaps honestly.

Do not rewrite the body after every follow-up push. Record later CI fixes, newly discovered design issues, promoted deferred work, and Self-Review results as formal GitHub pull-request reviews with the `COMMENT` event so the thread preserves chronology. Use inline review comments when an observation belongs to a changed line and the review body for commit-wide or round-wide results. Do not use ordinary issue-style pull-request comments for this ledger, and never `APPROVE` or `REQUEST_CHANGES` on your own pull request. The title describes the merged outcome, not the work process.

Push only the topic branch with upstream tracking. Use a file-backed body for multiline Markdown when opening through `gh`.

## Watch Checks After Every Ordinary Push

After each ordinary push, monitor the pull-request checks until every relevant check settles. A solo issue-campaign implementation wave is the one exception: it reads checks once per settled head under the [solo campaign development document](../issue-campaign/development.md#validate-with-ci-and-self-review), because a further push cancels the run in progress. `.github/workflows/test.yml` builds, tests, and enforces coverage on Ubuntu, Windows, and macOS. Changes under `packages/graph`, `tests/experiment`, the experiment workflow, or workspace lock/config files can also trigger the real-language-server matrix in `.github/workflows/experiment.yml`.

On failure, fetch the relevant job log, diagnose the real cause, fix it in place, push a coherent follow-up commit, and resume monitoring. Do not treat a green unrelated job as acceptance for a failed platform, coverage, or language lane.

## Merge On Explicit Request Or Standing Autonomous Mandate

Do not merge, squash-merge, rebase, or update the target branch on unprompted initiative. Merge when the user explicitly asks, or when a standing autonomous mandate authorizes end-to-end delivery. Use the repository's established merge method unless another is specified.

Before merging, confirm required checks pass and complete the review skill's solo Self-Review. If branch protection or an unavailable required check blocks the requested merge, report the blocker rather than bypassing it.
