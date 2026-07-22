# Releasing

Releases publish `@samchon/graph-sitter` before `@samchon/graph` from the exact
tarballs inspected by the `release` workflow. The workflow creates the GitHub
release only after npm serves both packages and a clean project installs and
uses them.

## Registry authority

The `npm` GitHub environment owns release authority. Keep required reviewers
enabled and store `NPM_TOKEN` there until both npm packages are bootstrapped and
configured for trusted publishing. Do not put registry credentials in the
repository or workflow.

Set the environment variable `RELEASE_APPROVED_SHA` to the full commit SHA that
is approved for release. The tag, both package versions, this value, and the
commit reachable from `master` must all agree before verification starts.

## Procedure

1. Choose a version newer than every version previously submitted to npm.
2. Set both publishable package manifests to that exact version and merge the
   change to `master`.
3. Set `RELEASE_APPROVED_SHA` in the `npm` environment to the full merged SHA.
4. Create the immutable `vX.Y.Z` tag at that SHA and push the tag.
5. Approve the `npm` environment deployment after confirming the workflow names
   the intended tag and SHA.

If any publication step fails, diagnose it and release a new package version
from a new immutable tag. Never move a release tag or reuse a version submitted
to npm.
