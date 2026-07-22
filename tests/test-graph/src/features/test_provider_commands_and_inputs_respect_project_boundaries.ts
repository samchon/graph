import { TestValidator } from "@nestia/e2e";
import fs from "node:fs";
import path from "node:path";

import {
  goGraphProvider,
  providerInputFiles,
  resolveProviderCommand,
} from "@samchon/graph";

import { GraphPaths } from "../internal/GraphPaths";

/** Provider discovery is project-local, platform-correct, and repository-safe. */
export const test_provider_commands_and_inputs_respect_project_boundaries =
  () => {
    const root = GraphPaths.createTempDirectory("graph-provider-resolution-");
    try {
      fs.mkdirSync(path.join(root, "src", "nested"), { recursive: true });
      fs.mkdirSync(path.join(root, "ignored", "node_modules"), {
        recursive: true,
      });
      fs.mkdirSync(path.join(root, "foreign", ".git"), { recursive: true });
      fs.writeFileSync(path.join(root, "main.go"), "package main\n");
      fs.writeFileSync(path.join(root, "native.h"), "#define VALUE 1\n");
      fs.writeFileSync(path.join(root, "src", "nested", "worker.go"), "package nested\n");
      fs.writeFileSync(path.join(root, "go.mod"), "module example.com/main\n");
      fs.writeFileSync(path.join(root, "src", "nested", "go.mod"), "module example.com/nested\n");
      fs.writeFileSync(path.join(root, "ignored", "node_modules", "go.mod"), "ignored\n");
      fs.writeFileSync(path.join(root, "foreign", "go.mod"), "foreign\n");
      fs.writeFileSync(path.join(root, "foreign", "foreign.go"), "package foreign\n");

      TestValidator.equals(
        "source and nested build inputs are sorted inside one checkout",
        providerInputFiles(root, ["go"], ["go.mod", "go.work"]),
        ["go.mod", "main.go", "src/nested/go.mod", "src/nested/worker.go"],
      );
      fs.mkdirSync(path.join(root, "vendor"), { recursive: true });
      fs.mkdirSync(path.join(root, "vendor", "example.com", "dep"), {
        recursive: true,
      });
      fs.mkdirSync(path.join(root, "vendor", ".git"), { recursive: true });
      fs.mkdirSync(path.join(root, "a", "vendor"), { recursive: true });
      fs.writeFileSync(path.join(root, "vendor", "modules.txt"), "# pinned\n");
      fs.writeFileSync(
        path.join(root, "vendor", "example.com", "dep", "dep.go"),
        "package dep\n",
      );
      fs.writeFileSync(path.join(root, "vendor", ".git", "ignored.go"), "ignored\n");
      fs.writeFileSync(path.join(root, "a", "go.mod"), "module example.com/a\n");
      fs.writeFileSync(
        path.join(root, "a", "vendor", "modules.txt"),
        "# nested pinned\n",
      );
      TestValidator.equals(
        "the Go provider fences module, workspace, source, and vendor inputs",
        [
          typeof goGraphProvider.buildInputs === "function"
            ? goGraphProvider.buildInputs(root)
            : [],
          goGraphProvider.inputs(root),
          goGraphProvider.indexArgs("snapshot.json"),
          goGraphProvider.configuration(root, ["go"]).some((row) =>
            row.startsWith("GOOS="),
          ),
        ],
        [
          [
            "a/go.mod",
            "a/vendor/modules.txt",
            "go.mod",
            "native.h",
            "src/nested/go.mod",
            "vendor/example.com/dep/dep.go",
            "vendor/modules.txt",
          ],
          [
            "a/go.mod",
            "a/vendor/modules.txt",
            "go.mod",
            "main.go",
            "native.h",
            "src/nested/go.mod",
            "src/nested/worker.go",
            "vendor/example.com/dep/dep.go",
            "vendor/modules.txt",
          ],
          ["--output=snapshot.json"],
          true,
        ],
      );
      TestValidator.predicate(
        "an unavailable Go toolchain is part of the effective configuration",
        goGraphProvider
          .effectiveConfiguration(root, pathEnvironment(""))
          .includes("go-env=unavailable"),
      );

      const command = "samchon-provider-resolution-fixture";
      const privateBin = path.join(root, ".samchon-graph", "bin");
      const packageBin = path.join(root, "node_modules", ".bin");
      fs.mkdirSync(privateBin, { recursive: true });
      fs.mkdirSync(packageBin, { recursive: true });
      const emptyPath = pathEnvironment("");

      const failingGo = platformExecutable(privateBin, "go");
      writeExecutable(failingGo, 1);
      TestValidator.predicate(
        "a failing Go environment probe is part of the effective configuration",
        goGraphProvider
          .effectiveConfiguration(root, {
            ...emptyPath,
            SAMCHON_GRAPH_GO_TOOLCHAIN: failingGo,
          })
          .includes("go-env=unavailable"),
      );
      fs.rmSync(failingGo, { force: true });

      const local = platformExecutable(privateBin, command);
      const dependency = platformExecutable(packageBin, command);
      writeExecutable(local);
      writeExecutable(dependency);
      TestValidator.equals(
        "the graph-owned project executable wins over package shims and PATH",
        resolveProviderCommand(root, emptyPath, {
          command,
          override: "SAMCHON_TEST_PROVIDER",
          args: ["serve"],
        }),
        expectedCommand(local, ["serve"]),
      );

      const goCommand = platformExecutable(privateBin, "samchon-graph-go");
      writeExecutable(goCommand);
      TestValidator.equals(
        "the shipped Go provider uses the common project-local resolver",
        goGraphProvider.resolve(root, emptyPath),
        expectedCommand(goCommand),
      );
      fs.rmSync(goCommand, { force: true });
      const bundledGo = goGraphProvider.resolve(root, process.env);
      TestValidator.predicate(
        "the packaged Go source sidecar runs through the available toolchain",
        bundledGo !== undefined &&
          bundledGo.args.includes("-C") &&
          bundledGo.args.slice(-2).join(" ") === "run .",
      );
      if (bundledGo === undefined) {
        throw new Error("the packaged Go source sidecar was not resolved");
      }
      const sourceFlag = bundledGo.args.indexOf("-C");
      const bundledSource = bundledGo.args[sourceFlag + 1];
      if (sourceFlag < 0 || bundledSource === undefined) {
        throw new Error("the packaged Go source directory was not resolved");
      }
      const bundledManifest = path.join(bundledSource, "go.mod");
      const hiddenManifest = `${bundledManifest}.test-hidden`;
      fs.renameSync(bundledManifest, hiddenManifest);
      try {
        TestValidator.equals(
          "a malformed package without its Go source sidecar declines cleanly",
          goGraphProvider.resolve(root, process.env),
          undefined,
        );
      } finally {
        fs.renameSync(hiddenManifest, bundledManifest);
      }
      TestValidator.equals(
        "the packaged Go source sidecar declines without a Go toolchain",
        goGraphProvider.resolve(root, emptyPath),
        undefined,
      );

      fs.rmSync(local, { force: true });
      TestValidator.equals(
        "a project dependency wins before PATH",
        resolveProviderCommand(root, emptyPath, {
          command,
          override: "SAMCHON_TEST_PROVIDER",
        }),
        expectedCommand(dependency),
      );

      const override = platformExecutable(root, "explicit-provider");
      writeExecutable(override);
      TestValidator.equals(
        "an absolute executable override wins before project-local discovery",
        resolveProviderCommand(
          root,
          {
            ...emptyPath,
            SAMCHON_TEST_PROVIDER: override,
          },
          { command, override: "SAMCHON_TEST_PROVIDER", args: ["index"] },
        ),
        expectedCommand(override, ["index"]),
      );
      if (process.platform === "win32") {
        const batchOverride = path.join(root, "explicit-provider.bat");
        writeExecutable(batchOverride);
        TestValidator.equals(
          "an absolute Windows batch override uses the exact command shim",
          resolveProviderCommand(
            root,
            {
              ...emptyPath,
              SAMCHON_TEST_PROVIDER: batchOverride,
            },
            { command, override: "SAMCHON_TEST_PROVIDER" },
          ),
          expectedCommand(batchOverride),
        );
      }

      const pathBin = path.join(root, "path-bin");
      fs.mkdirSync(pathBin);
      const onPath = platformExecutable(pathBin, "path-only-provider");
      writeExecutable(onPath);
      TestValidator.equals(
        "PATH is consulted only after project-local candidates",
        resolveProviderCommand(root, pathEnvironment(pathBin), {
          command: "path-only-provider",
          override: "SAMCHON_TEST_PROVIDER",
        }),
        expectedCommand(onPath),
      );
      TestValidator.equals(
        "a relative override is not treated as an executable identity",
        resolveProviderCommand(
          root,
          {
            ...pathEnvironment(pathBin),
            SAMCHON_TEST_PROVIDER: "path-only-provider",
          },
          {
            command: "path-only-provider",
            override: "SAMCHON_TEST_PROVIDER",
          },
        ),
        expectedCommand(onPath),
      );
      TestValidator.equals(
        "a directory override is not treated as an executable file",
        resolveProviderCommand(
          root,
          {
            ...pathEnvironment(pathBin),
            SAMCHON_TEST_PROVIDER: root,
          },
          {
            command: "path-only-provider",
            override: "SAMCHON_TEST_PROVIDER",
          },
        ),
        expectedCommand(onPath),
      );
      TestValidator.equals(
        "an unavailable provider resolves to no command",
        resolveProviderCommand(root, emptyPath, {
          command: "definitely-not-a-real-samchon-provider",
          override: "SAMCHON_TEST_PROVIDER",
        }),
        undefined,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };

function platformExecutable(directory: string, command: string): string {
  return path.join(
    directory,
    process.platform === "win32" ? `${command}.cmd` : command,
  );
}

function writeExecutable(file: string, exitCode: number = 0): void {
  fs.writeFileSync(
    file,
    process.platform === "win32"
      ? `@exit /b ${exitCode}\r\n`
      : `#!/bin/sh\nexit ${exitCode}\n`,
  );
  fs.chmodSync(file, 0o755);
}

function expectedCommand(
  executable: string,
  args: readonly string[] = [],
): { command: string; args: string[] } {
  return process.platform === "win32"
    ? {
        command: "cmd.exe",
        args: ["/d", "/s", "/c", executable, ...args],
      }
    : { command: executable, args: [...args] };
}

function pathEnvironment(value: string): NodeJS.ProcessEnv {
  return {
    PATH: value,
    Path: value,
    PATHEXT: ".EXE;.CMD;.BAT",
    SystemRoot: process.env.SystemRoot,
  };
}
