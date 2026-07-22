import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { publicationOrder, verifyReleaseInputs } from "./release-preflight.mjs";

const RELEASE_BRANCH = process.env.RELEASE_BRANCH ?? "master";
const root = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

const packages = readPackages(root);
const version = verifyReleaseInputs({
  tag: process.env.RELEASE_TAG ?? "",
  sha: process.env.RELEASE_SHA ?? "",
  approvedSha: process.env.RELEASE_APPROVED_SHA ?? "",
  onReleaseBranch: reachableFromReleaseBranch(process.env.RELEASE_SHA ?? ""),
  releaseBranch: RELEASE_BRANCH,
  packages,
});
const order = publicationOrder(packages);

// The workflow publishes in fixed, named jobs, because two packages do not
// justify generating them. That makes the job order a claim about the
// dependency graph, and a claim nobody checks is one that silently stops being
// true — a third package, or a dependency reversed between the two, would
// publish a dependent before its dependency exactly as v0.2.0 did.
const expected = (process.env.RELEASE_ORDER ?? "")
  .split(",")
  .map((name) => name.trim())
  .filter((name) => name !== "");
if (expected.length > 0 && expected.join(",") !== order.join(",")) {
  throw new Error(
    `release: the workflow publishes ${expected.join(" -> ")} but the manifests require ${order.join(" -> ")}`,
  );
}

process.stdout.write(`release: ${version} verified\n`);
process.stdout.write(`release: publication order ${order.join(" -> ")}\n`);
appendOutput(`version=${version}`);
appendOutput(`order=${order.join(",")}`);

/** Every workspace package that is meant to reach the registry. */
function readPackages(workspace) {
  const directory = path.join(workspace, "packages");
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const manifest = JSON.parse(
        fs.readFileSync(
          path.join(directory, entry.name, "package.json"),
          "utf8",
        ),
      );
      return {
        name: manifest.name,
        version: manifest.version,
        private: manifest.private === true,
        access: manifest.publishConfig?.access,
        files: manifest.files,
        dependencies: Object.keys(manifest.dependencies ?? {}),
      };
    })
    .filter((entry) => !entry.private);
}

/**
 * Whether the tagged commit was merged into the release branch.
 *
 * `git merge-base --is-ancestor` answers exactly this and exits non-zero when
 * it does not hold, so a missing branch and an unmerged commit are both
 * refusals rather than a silent pass.
 */
function reachableFromReleaseBranch(sha) {
  if (sha === "") return false;
  try {
    execFileSync(
      "git",
      ["merge-base", "--is-ancestor", sha, `origin/${RELEASE_BRANCH}`],
      { cwd: root, stdio: "ignore" },
    );
    return true;
  } catch {
    return false;
  }
}

function appendOutput(line) {
  const file = process.env.GITHUB_OUTPUT;
  if (file === undefined) return;
  fs.appendFileSync(file, `${line}\n`);
}
