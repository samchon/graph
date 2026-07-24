import { TestValidator } from "@nestia/e2e";
import fs from "node:fs";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";

/**
 * Core workflow actions stay on their maintained runtime generations.
 *
 * GitHub had begun forcing the former Node 20 actions onto Node 24, annotating
 * every test and experiment job. The release lane matters beyond the warning:
 * download-artifact v8 also makes an artifact digest mismatch fail closed, so
 * the exact tarballs verified before publication retain an enforced hand-off.
 */
export const test_workflows_use_current_core_action_runtimes = () => {
  const workflows = ["test.yml", "experiment.yml", "release.yml"].map(
    (file) =>
      fs.readFileSync(
        path.join(GraphPaths.repositoryRoot, ".github", "workflows", file),
        "utf8",
      ),
  );
  const actual = workflows.flatMap((workflow) => {
    const matches = workflow.matchAll(
      /uses:\s+actions\/(checkout|setup-go|setup-node|upload-artifact|download-artifact)@v(\d+)/g,
    );
    return [...matches].map((match) => `${match[1]}@v${match[2]}`);
  });

  TestValidator.equals(
    "every core action use names the maintained major",
    actual.sort(),
    [
      ...Array(6).fill("checkout@v7"),
      ...Array(2).fill("download-artifact@v8"),
      ...Array(3).fill("setup-go@v7"),
      ...Array(5).fill("setup-node@v7"),
      ...Array(2).fill("upload-artifact@v7"),
    ].sort(),
  );

  const release = workflows[2]!;
  TestValidator.equals(
    "release verification uploads both inspected tarballs together",
    occurrences(release, "name: tarballs"),
    3,
  );
  TestValidator.equals(
    "release verification selects only packed tarballs",
    occurrences(release, "path: .release/*.tgz"),
    1,
  );
  TestValidator.equals(
    "both publishers download the verified tarball artifact",
    occurrences(release, "uses: actions/download-artifact@v8"),
    2,
  );
  TestValidator.predicate(
    "exact local tarballs execute before their artifact can be uploaded",
    release.indexOf("node build/release-smoke.mjs") <
      release.indexOf("uses: actions/upload-artifact@v7"),
  );
  TestValidator.predicate(
    "a production advisory fails before either publication job",
    release.indexOf("pnpm audit --prod") <
      release.indexOf("publish-graph-sitter:"),
  );
  TestValidator.predicate(
    "the packaged Go source fallback uses a pinned workflow-local SCIP producer",
    release.includes(
      "go install github.com/scip-code/scip-go/cmd/scip-go@v0.2.7",
    ) &&
      release.includes("RELEASE_SCIP_GO:"),
  );
  const releaseJob = release.slice(release.indexOf("\n  release:"));
  TestValidator.predicate(
    "the release job installs its locked changelog tool before executing it",
    releaseJob.indexOf("pnpm install --frozen-lockfile") !== -1 &&
      releaseJob.indexOf("pnpm install --frozen-lockfile") <
        releaseJob.indexOf("pnpm exec changelogithub"),
  );

  const releasePack = fs.readFileSync(
    path.join(GraphPaths.repositoryRoot, "build", "release-pack.mjs"),
    "utf8",
  );
  const releasePublish = fs.readFileSync(
    path.join(GraphPaths.repositoryRoot, "build", "release-publish.mjs"),
    "utf8",
  );
  const releaseSmoke = fs.readFileSync(
    path.join(GraphPaths.repositoryRoot, "build", "release-smoke.mjs"),
    "utf8",
  );
  TestValidator.predicate(
    "archive inspection never passes an absolute drive path to tar",
    [releasePack, releasePublish].every(
      (script) =>
        script.includes("path.basename(tarball)") &&
        script.includes("cwd: path.dirname(tarball)"),
    ),
  );
  for (const surface of [
    "MCP handshake",
    "packaged viewer",
    "packaged Go source fallback",
    "graph-sitter tarballs",
  ]) {
    TestValidator.predicate(
      `the exact-artifact smoke proves ${surface}`,
      releaseSmoke.includes(surface),
    );
  }
};

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}
