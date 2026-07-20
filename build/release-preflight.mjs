/**
 * The gate a tag must pass before either package is published.
 *
 * `v0.2.0` failed with npm E404 after a workflow that built and published in
 * two steps and checked nothing in between. That failure is not interesting on
 * its own; what makes it worth a gate is that the workflow could not have
 * noticed any of the ways it was already wrong — a tag naming a version no
 * manifest carried, two packages drifting apart, a tarball missing the `lib`
 * it advertises, a dependent published before its dependency exists. Each is
 * silent until an install fails in somebody else's project.
 *
 * These functions are pure so they can be proved by tests rather than by
 * pushing tags. The workflow supplies the real inputs.
 */

/**
 * The exact release version a tag names.
 *
 * Immutable `vX.Y.Z` only. A prerelease, a build suffix, or a floating tag
 * would each publish something whose identity cannot be recovered from the tag
 * afterwards, and the recovery path for a failed release is a *new* version —
 * never a moved tag, because npm will not accept the same version twice and a
 * moved tag makes the published artifact unattributable.
 */
export function releaseVersionOf(tag) {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag);
  if (match === null) {
    throw new Error(
      `release: tag "${tag}" is not an immutable vX.Y.Z release tag; recover a failed release with a new version rather than a moved or prerelease tag`,
    );
  }
  return `${match[1]}.${match[2]}.${match[3]}`;
}

/**
 * Prove the tag, every publishable manifest, and the released commit agree.
 *
 * All three, because each pair alone leaves a real failure open: a tag that
 * matches the manifests can still point at a commit that was never merged, and
 * a merged commit can still carry two packages at different versions — which
 * is exactly how a `@samchon/graph` depending on a `@samchon/graph-sitter`
 * version that was never published gets released.
 *
 * "Approved" is reachability from the release branch rather than a SHA written
 * down somewhere. A tag on an unmerged branch publishes code that no review
 * gate saw, and it is the one form of unapproved release that a workflow can
 * detect on its own.
 */
export function verifyReleaseInputs({
  tag,
  sha,
  onReleaseBranch,
  releaseBranch,
  packages,
}) {
  const version = releaseVersionOf(tag);
  if (typeof sha !== "string" || sha === "") {
    throw new Error("release: the released commit SHA is missing");
  }
  if (onReleaseBranch !== true) {
    throw new Error(
      `release: ${tag} points at ${sha}, which is not reachable from ${releaseBranch}; publish only commits that were merged there`,
    );
  }
  if (packages.length === 0) {
    throw new Error("release: no publishable package was found");
  }
  for (const entry of packages) {
    if (entry.version !== version) {
      throw new Error(
        `release: ${entry.name} is at ${entry.version} but ${tag} names ${version}`,
      );
    }
    if (entry.private === true) {
      throw new Error(
        `release: ${entry.name} is private and cannot be published`,
      );
    }
    // A scoped package defaults to restricted access. Publishing one without
    // saying otherwise is the E404 this gate exists to stop, and saying it in
    // the manifest rather than on the command line means every publisher —
    // the workflow, a maintainer, a future script — gets the same answer.
    if (entry.name.startsWith("@") && entry.access !== "public") {
      throw new Error(
        `release: ${entry.name} is scoped but does not declare publishConfig.access "public", so npm would reject it as unauthorized`,
      );
    }
  }
  return version;
}

/**
 * The order two packages must be published in.
 *
 * A dependency before its dependent, always. npm accepts a dependent whose
 * dependency does not exist — publishing is not resolution — so the broken
 * state is only discovered by whoever installs it next, which is precisely the
 * shape of the reported failure: graph published, graph-sitter absent.
 */
export function publicationOrder(packages) {
  const names = new Set(packages.map((entry) => entry.name));
  const ordered = [];
  const visiting = new Set();
  const visit = (entry) => {
    if (ordered.includes(entry.name)) return;
    if (visiting.has(entry.name)) {
      throw new Error(
        `release: ${entry.name} takes part in a dependency cycle, so no publication order is safe`,
      );
    }
    visiting.add(entry.name);
    for (const dependency of entry.dependencies ?? []) {
      if (!names.has(dependency)) continue;
      visit(packages.find((candidate) => candidate.name === dependency));
    }
    visiting.delete(entry.name);
    ordered.push(entry.name);
  };
  for (const entry of packages) visit(entry);
  return ordered;
}

/**
 * Prove a packed tarball actually contains what its manifest advertises.
 *
 * `files` is a promise about the published artifact, and nothing checks it: a
 * build that silently produced no `lib` still packs, still publishes, and
 * still installs — and then fails at the first `import`, in a consumer's
 * project, with an error that names their code rather than this release.
 */
export function verifyTarballContents({ name, files, entries }) {
  const packed = new Set(entries.map(normalizeEntry));
  const missing = (files ?? []).filter(
    (advertised) =>
      ![...packed].some(
        (entry) =>
          entry === advertised || entry.startsWith(`${advertised.replace(/\/$/, "")}/`),
      ),
  );
  if (missing.length > 0) {
    throw new Error(
      `release: ${name}'s tarball advertises ${missing.join(", ")} but does not contain it`,
    );
  }
  if (!packed.has("package.json")) {
    throw new Error(`release: ${name}'s tarball has no package.json`);
  }
  return [...packed].sort();
}

/** `npm pack` prints entries under a leading `package/` directory. */
function normalizeEntry(entry) {
  return entry.replace(/^package\//, "");
}
