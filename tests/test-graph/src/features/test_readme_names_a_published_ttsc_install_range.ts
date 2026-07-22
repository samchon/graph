import { TestValidator } from "@nestia/e2e";
import fs from "node:fs";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";

/** The public install command must name a version npm actually serves. */
export const test_readme_names_a_published_ttsc_install_range = () => {
  const install = "npm i -D ttsc@^0.19.3 typescript";
  for (const readme of [
    path.join(GraphPaths.repositoryRoot, "README.md"),
    path.join(GraphPaths.graphPackageRoot, "README.md"),
  ]) {
    const text = fs.readFileSync(readme, "utf8");
    TestValidator.predicate(
      `${path.relative(GraphPaths.repositoryRoot, readme)} names the published ttsc line`,
      text.includes(install),
    );
    TestValidator.predicate(
      `${path.relative(GraphPaths.repositoryRoot, readme)} does not predict an unpublished ttsc line`,
      text.includes("ttsc@^0.19.4") === false,
    );
  }
};
