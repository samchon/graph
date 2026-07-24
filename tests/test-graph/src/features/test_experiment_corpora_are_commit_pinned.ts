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
  const python = catalog.slice(
    catalog.indexOf('language: "python"'),
    catalog.indexOf('language: "ruby"'),
  );
  TestValidator.predicate(
    "the dynamic SCIP smoke proves a versioned Python lifecycle, not an edge count",
    python.includes('strictProvider: "scip-python"') &&
      python.includes('strictAuthority: "semantic-index"') &&
      python.includes('semanticEdges: ["contains", "references"]') &&
      !python.includes("minEdges"),
  );
  // scip-python 0.6.6 recovers from a malformed `pyproject.toml` and emits no
  // SCIP diagnostics, so a row claiming either boundary would assert behaviour
  // the pinned producer does not have. A tolerated row has to say what it gave
  // up instead of leaving the reader to infer it from a passing lane.
  TestValidator.predicate(
    "a failure boundary the producer does not have is published as a limitation",
    python.includes('failurePolicy: "tolerated"') &&
      python.includes("failureLimitation:") &&
      !python.includes('failurePolicy: "reject"'),
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

  const setup = fs.readFileSync(
    path.join(
      GraphPaths.repositoryRoot,
      "tests",
      "experiment",
      "src",
      "setup-language.mjs",
    ),
    "utf8",
  );
  // A digest over the root archive proves nothing while installation still
  // resolves that archive's dependency ranges against whatever the registry
  // serves that hour. Extracting the verified bytes is what makes the toolchain
  // the same one the next run gets.
  const installPython = setup.slice(
    setup.indexOf("const installScipPython"),
    setup.indexOf("const findFile"),
  );
  TestValidator.predicate(
    "the Python indexer and decoder are exact campaign-owned tools",
    installPython.includes("scip-python-0.6.6.tgz") &&
      installPython.includes(
        "qoKL1Rggg0o5newAFbCFAKlS0AjWxG5MA+mC28BtgxOv0DhO4zdL8u7151FxEppDpXMVvm7+yXSjXotoVH9cMQ==",
      ) &&
      installPython.includes('run("tar"') &&
      !installPython.includes('run("npm"') &&
      setup.includes("await installScipPython();") &&
      setup.includes("await installScip();") &&
      !setup.includes("npm install -g pyright"),
  );
};
