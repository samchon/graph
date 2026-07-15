import { TestValidator } from "@nestia/e2e";
import fs from "node:fs";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";

export const test_readme_embeds_the_exact_application_contract = () => {
  const source = fs
    .readFileSync(
      path.join(
        GraphPaths.graphPackageRoot,
        "src",
        "structures",
        "ISamchonGraphApplication.ts",
      ),
      "utf8",
    )
    .replace(/\r/g, "");
  const expected = source.slice(source.indexOf("/**")).trim();

  const readme = fs
    .readFileSync(path.join(GraphPaths.repositoryRoot, "README.md"), "utf8")
    .replace(/\r/g, "");
  const marker = "```typescript\n/**";
  const start = readme.indexOf(marker);
  const end = readme.indexOf("\n```", start);
  TestValidator.predicate(
    "the README contains the application contract",
    start >= 0 && end > start,
  );
  const actual = readme
    .slice(start + "```typescript\n".length, end)
    .trim();
  TestValidator.equals(
    "the README contract is byte-for-byte the source contract",
    actual,
    expected,
  );
};
