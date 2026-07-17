import { TestValidator } from "@nestia/e2e";
import { ensurePubDeps } from "@samchon/graph";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";

const fakePub = [process.execPath, GraphPaths.fakePub];

const packageConfigOf = (dir: string): string =>
  path.join(dir, ".dart_tool", "package_config.json");

const writePubspec = (dir: string): void => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "pubspec.yaml"), "name: fixture\n");
};

export const test_ensure_pub_deps_bootstraps_or_skips_pub = async () => {
  {
    const root = GraphPaths.createTempDirectory("samchon-graph-pub-single-");
    writePubspec(root);
    ensurePubDeps(root, fakePub);
    TestValidator.predicate(
      "an unresolved package gets pub get",
      fs.existsSync(packageConfigOf(root)),
    );
  }

  {
    const root = GraphPaths.createTempDirectory("samchon-graph-pub-resolved-");
    writePubspec(root);
    fs.mkdirSync(path.join(root, ".dart_tool"));
    fs.writeFileSync(packageConfigOf(root), '{"marker":true}');
    ensurePubDeps(root, fakePub);
    TestValidator.equals(
      "an already-resolved package is left untouched",
      fs.readFileSync(packageConfigOf(root), "utf8"),
      '{"marker":true}',
    );
  }

  {
    const root = GraphPaths.createTempDirectory("samchon-graph-pub-workspace-");
    writePubspec(path.join(root, "pkgs", "a"));
    writePubspec(path.join(root, "pkgs", "b"));
    fs.mkdirSync(path.join(root, "build"));
    fs.writeFileSync(path.join(root, "build", "pubspec.yaml"), "name: ignored\n");
    ensurePubDeps(root, fakePub);
    TestValidator.predicate(
      "every pubspec root in a monorepo gets its own pub get",
      fs.existsSync(packageConfigOf(path.join(root, "pkgs", "a"))) &&
        fs.existsSync(packageConfigOf(path.join(root, "pkgs", "b"))),
    );
    TestValidator.predicate(
      "a build/ directory is not treated as a package root",
      !fs.existsSync(packageConfigOf(path.join(root, "build"))),
    );
  }

  {
    const root = GraphPaths.createTempDirectory("samchon-graph-pub-fail-");
    writePubspec(root);
    process.env.FAKE_PUB_FAIL = "1";
    try {
      ensurePubDeps(root, fakePub);
    } finally {
      delete process.env.FAKE_PUB_FAIL;
    }
    TestValidator.predicate(
      "a failing pub get leaves the package unresolved without throwing",
      !fs.existsSync(packageConfigOf(root)),
    );
  }

  {
    const root = GraphPaths.createTempDirectory("samchon-graph-pub-deep-");
    const deep = path.join(root, "a", "b", "c", "d", "e");
    writePubspec(deep);
    ensurePubDeps(root, fakePub);
    TestValidator.predicate(
      "a pubspec beyond the depth cap is not discovered",
      !fs.existsSync(packageConfigOf(deep)),
    );
  }

  ensurePubDeps(path.join(os.tmpdir(), "samchon-graph-pub-missing-root"), fakePub);
};
