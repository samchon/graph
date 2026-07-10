import { TestValidator } from "@nestia/e2e";
import { ensureCompileCommands } from "@samchon/graph";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { GraphFixtures } from "../internal/GraphFixtures";
import { GraphPaths } from "../internal/GraphPaths";

const fakeCmake = [process.execPath, GraphPaths.fakeCmake];

export const test_ensure_compile_commands_bootstraps_or_skips_cmake = async () => {
  {
    const root = GraphFixtures.createCmakeFixture();
    fs.writeFileSync(path.join(root, "compile_commands.json"), "[]");
    TestValidator.equals(
      "an existing root compile_commands.json is left alone",
      ensureCompileCommands(root, fakeCmake),
      undefined,
    );
  }

  {
    const root = GraphFixtures.createCmakeFixture();
    fs.mkdirSync(path.join(root, "build"));
    fs.writeFileSync(path.join(root, "build", "compile_commands.json"), "[]");
    TestValidator.equals(
      "an existing build/compile_commands.json is left alone",
      ensureCompileCommands(root, fakeCmake),
      undefined,
    );
  }

  {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-cmake-none-"));
    TestValidator.equals(
      "a project without CMakeLists.txt is skipped",
      ensureCompileCommands(root, fakeCmake),
      undefined,
    );
  }

  {
    const root = GraphFixtures.createCmakeFixture();
    const buildDir = ensureCompileCommands(root, fakeCmake);
    TestValidator.predicate(
      "a successful configure returns a directory with compile_commands.json",
      buildDir !== undefined && fs.existsSync(path.join(buildDir, "compile_commands.json")),
    );
  }

  {
    const root = GraphFixtures.createCmakeFixture();
    process.env.FAKE_CMAKE_FAIL = "1";
    try {
      TestValidator.equals(
        "a failing configure is swallowed",
        ensureCompileCommands(root, fakeCmake),
        undefined,
      );
    } finally {
      delete process.env.FAKE_CMAKE_FAIL;
    }
  }

  {
    const root = GraphFixtures.createCmakeFixture();
    process.env.FAKE_CMAKE_NO_OUTPUT = "1";
    try {
      TestValidator.equals(
        "a configure that produces no compile_commands.json is treated as a miss",
        ensureCompileCommands(root, fakeCmake),
        undefined,
      );
    } finally {
      delete process.env.FAKE_CMAKE_NO_OUTPUT;
    }
  }

  {
    const root = GraphFixtures.createCmakeFixture();
    TestValidator.equals(
      "a missing cmake binary is swallowed",
      ensureCompileCommands(root, ["samchon-graph-nonexistent-cmake-binary"]),
      undefined,
    );
  }
};
