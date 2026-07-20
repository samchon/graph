import { TestValidator } from "@nestia/e2e";

// Release tooling is plain ESM at the repository root: it must run from a
// checkout with nothing built, which is exactly the state a release starts in.
// The deterministic suite bundles it like any other module, so the gate is
// proved by tests rather than by pushing tags at the registry.
import {
  publicationOrder,
  releaseVersionOf,
  verifyReleaseInputs,
  verifyTarballContents,
} from "../../../../build/release-preflight.mjs";

/**
 * The release gate refuses every shape that produced the broken `v0.2.0`.
 *
 * `v0.2.0` published nothing usable: npm still served graph 0.1.0,
 * `@samchon/graph-sitter` was absent, and GitHub had no release. The workflow
 * could not have noticed, because it built and published in two steps and
 * checked nothing in between. Each case below is one of those blind spots,
 * with a control proving the gate still admits a correct release.
 */
export const test_release_preflight_refuses_an_unpublishable_release =
  async () => {
    const packages = [
      graphSitter(),
      graph(),
    ];

    // --- the tag itself ------------------------------------------------
    TestValidator.equals(
      "an immutable release tag names its version",
      releaseVersionOf("v1.2.3"),
      "1.2.3",
    );
    for (const tag of ["1.2.3", "v1.2", "v1.2.3-beta.1", "v1.2.3+build", "latest"]) {
      TestValidator.error(`a non-release tag is refused: ${tag}`, () =>
        releaseVersionOf(tag),
      );
    }

    // --- tag, manifests, and commit must agree -------------------------
    TestValidator.equals(
      "a coherent release is admitted",
      verifyReleaseInputs({
        tag: "v0.2.0",
        sha: "abc",
        onReleaseBranch: true,
        releaseBranch: "master",
        packages,
      }),
      "0.2.0",
    );
    TestValidator.error("a tag ahead of the manifests is refused", () =>
      verifyReleaseInputs({
        tag: "v0.3.0",
        sha: "abc",
        onReleaseBranch: true,
        releaseBranch: "master",
        packages,
      }),
    );
    TestValidator.error("two packages at different versions are refused", () =>
      verifyReleaseInputs({
        tag: "v0.2.0",
        sha: "abc",
        onReleaseBranch: true,
        releaseBranch: "master",
        packages: [graphSitter({ version: "0.1.0" }), graph()],
      }),
    );
    TestValidator.error("an unmerged commit is refused", () =>
      verifyReleaseInputs({
        tag: "v0.2.0",
        sha: "abc",
        onReleaseBranch: false,
        releaseBranch: "master",
        packages,
      }),
    );
    TestValidator.error("a missing commit is refused", () =>
      verifyReleaseInputs({
        tag: "v0.2.0",
        sha: "",
        onReleaseBranch: true,
        releaseBranch: "master",
        packages,
      }),
    );
    TestValidator.error("publishing nothing is refused", () =>
      verifyReleaseInputs({
        tag: "v0.2.0",
        sha: "abc",
        onReleaseBranch: true,
        releaseBranch: "master",
        packages: [],
      }),
    );
    TestValidator.error("a private package in the release set is refused", () =>
      verifyReleaseInputs({
        tag: "v0.2.0",
        sha: "abc",
        onReleaseBranch: true,
        releaseBranch: "master",
        packages: [graphSitter({ private: true }), graph()],
      }),
    );
    // The reported E404 shape: a scoped package published without declaring
    // public access is rejected by npm as unauthorized.
    TestValidator.error("a scoped package without public access is refused", () =>
      verifyReleaseInputs({
        tag: "v0.2.0",
        sha: "abc",
        onReleaseBranch: true,
        releaseBranch: "master",
        packages: [graphSitter({ access: undefined }), graph()],
      }),
    );

    // --- publication order ---------------------------------------------
    TestValidator.equals(
      "a dependency is published before its dependent",
      publicationOrder(packages),
      ["@samchon/graph-sitter", "@samchon/graph"],
    );
    TestValidator.equals(
      "declaration order does not decide publication order",
      publicationOrder([graph(), graphSitter()]),
      ["@samchon/graph-sitter", "@samchon/graph"],
    );
    TestValidator.equals(
      "an external dependency does not enter the order",
      publicationOrder([graph({ dependencies: ["typia"] })]),
      ["@samchon/graph"],
    );
    TestValidator.error("a dependency cycle has no safe order", () =>
      publicationOrder([
        graphSitter({ dependencies: ["@samchon/graph"] }),
        graph(),
      ]),
    );

    // --- the tarball actually contains what it advertises ---------------
    TestValidator.equals(
      "a complete tarball passes inspection",
      verifyTarballContents({
        name: "@samchon/graph",
        files: ["README.md", "LICENSE", "lib", "src"],
        entries: [
          "package/package.json",
          "package/README.md",
          "package/LICENSE",
          "package/lib/index.js",
          "package/src/index.ts",
        ],
      }),
      ["LICENSE", "README.md", "lib/index.js", "package.json", "src/index.ts"],
    );
    // The silent build failure: `files` promises `lib`, the tarball has none,
    // and the package still publishes and installs.
    TestValidator.error("a tarball missing an advertised directory is refused", () =>
      verifyTarballContents({
        name: "@samchon/graph",
        files: ["README.md", "lib"],
        entries: ["package/package.json", "package/README.md"],
      }),
    );
    TestValidator.error("a tarball without a manifest is refused", () =>
      verifyTarballContents({
        name: "@samchon/graph",
        files: [],
        entries: ["package/lib/index.js"],
      }),
    );
    TestValidator.equals(
      "a package advertising nothing still needs its manifest",
      verifyTarballContents({
        name: "@samchon/graph",
        files: undefined,
        entries: ["package/package.json"],
      }),
      ["package.json"],
    );
  };

function graphSitter(overrides: Record<string, unknown> = {}): unknown {
  return {
    name: "@samchon/graph-sitter",
    version: "0.2.0",
    private: false,
    access: "public",
    files: ["LICENSE", "lib", "src"],
    dependencies: [],
    ...overrides,
  };
}

function graph(overrides: Record<string, unknown> = {}): unknown {
  return {
    name: "@samchon/graph",
    version: "0.2.0",
    private: false,
    access: "public",
    files: ["README.md", "LICENSE", "lib", "src"],
    dependencies: ["@samchon/graph-sitter"],
    ...overrides,
  };
}
