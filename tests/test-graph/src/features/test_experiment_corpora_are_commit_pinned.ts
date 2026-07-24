import { TestValidator } from "@nestia/e2e";
import fs from "node:fs";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";

/** Real-language experiments always check out one reviewable corpus revision. */
export const test_experiment_corpora_are_commit_pinned = () => {
  const catalog = fs.readFileSync(
    path.join(
      GraphPaths.repositoryRoot,
      "tests",
      "experiment",
      "src",
      "catalog.mjs",
    ),
    "utf8",
  );
  const repositories = [...catalog.matchAll(/repository:\s*"[^"]+"/g)];
  const commits = [...catalog.matchAll(/commit:\s*"([0-9a-f]{40})"/g)];
  TestValidator.equals(
    "every real-language corpus has one exact Git commit",
    commits.length,
    repositories.length,
  );
  TestValidator.equals(
    "every strict corpus declares an isolated lifecycle fixture",
    [...catalog.matchAll(/strictProvider:\s*"[^"]+"/g)].length,
    [...catalog.matchAll(/lifecycle:\s*\{/g)].length,
  );

  const process = fs.readFileSync(
    path.join(
      GraphPaths.repositoryRoot,
      "tests",
      "experiment",
      "src",
      "process.mjs",
    ),
    "utf8",
  );
  TestValidator.predicate(
    "the clone helper fetches and detaches the pinned revision",
    process.includes('["fetch", "--depth=1", "origin", experiment.commit]') &&
      process.includes('["checkout", "--detach", experiment.commit]'),
  );

  const lifecycle = fs.readFileSync(
    path.join(
      GraphPaths.repositoryRoot,
      "tests",
      "experiment",
      "src",
      "strict-lifecycle.mjs",
    ),
    "utf8",
  );
  TestValidator.predicate(
    "strict edits happen only in a copied external workspace",
    lifecycle.includes("fs.cpSync(pinnedRoot, lifecycleRoot") &&
      lifecycle.includes("path.join(lifecycleRoot, fixture.sourceFile)"),
  );
};
