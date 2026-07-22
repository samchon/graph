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
      /uses:\s+actions\/(checkout|setup-node|upload-artifact|download-artifact)@v(\d+)/g,
    );
    return [...matches].map((match) => `${match[1]}@v${match[2]}`);
  });

  TestValidator.equals(
    "every core action use names the maintained major",
    actual.sort(),
    [
      ...Array(6).fill("checkout@v7"),
      ...Array(2).fill("download-artifact@v8"),
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
};

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}
