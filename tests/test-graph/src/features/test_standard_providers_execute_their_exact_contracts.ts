import { TestValidator } from "@nestia/e2e";
import {
  standardScipProviders,
  standardSidecarProviders,
} from "@samchon/graph";
import fs from "node:fs";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";

/** Every standard registry entry executes its own discovery and wire contract. */
export const test_standard_providers_execute_their_exact_contracts =
  async () => {
    const root = GraphPaths.createTempDirectory("graph-standard-providers-");
    const previous = new Map<string, string | undefined>();
    try {
      writeProject(root);
      const bin = path.join(root, ".samchon-graph", "bin");
      fs.mkdirSync(bin, { recursive: true });

      const names = [
        "scip-clang",
        "scip-java",
        "scip-dotnet",
        "scip-python",
        "scip-ruby",
        "scip",
        "samchon-graph-swift",
        "samchon-graph-zig",
        "samchon-graph-php",
        "samchon-graph-lua",
        "samchon-graph-dart",
      ];
      for (const name of names) {
        writeShim(platformExecutable(bin, name), name);
      }

      const overrides: Record<string, string> = {
        SAMCHON_GRAPH_SCIP_CLANG: platformExecutable(bin, "scip-clang"),
        SAMCHON_GRAPH_SCIP_JAVA: platformExecutable(bin, "scip-java"),
        SAMCHON_GRAPH_SCIP_DOTNET: platformExecutable(bin, "scip-dotnet"),
        SAMCHON_GRAPH_SCIP_PYTHON: platformExecutable(bin, "scip-python"),
        SAMCHON_GRAPH_SCIP_RUBY: platformExecutable(bin, "scip-ruby"),
        SAMCHON_GRAPH_SCIP: platformExecutable(bin, "scip"),
        SAMCHON_GRAPH_SWIFT: platformExecutable(bin, "samchon-graph-swift"),
        SAMCHON_GRAPH_ZIG: platformExecutable(bin, "samchon-graph-zig"),
        SAMCHON_GRAPH_PHP: platformExecutable(bin, "samchon-graph-php"),
        SAMCHON_GRAPH_LUA: platformExecutable(bin, "samchon-graph-lua"),
        SAMCHON_GRAPH_DART: platformExecutable(bin, "samchon-graph-dart"),
      };
      for (const [key, value] of Object.entries(overrides)) {
        previous.set(key, process.env[key]);
        process.env[key] = value;
      }

      for (const provider of standardScipProviders) {
        const command = provider.resolve(root, process.env);
        TestValidator.predicate(
          `${provider.name} resolves its exact producer and decoder`,
          command !== undefined,
        );
        if (command === undefined) {
          throw new Error(`${provider.name}: fixture command did not resolve`);
        }
        TestValidator.predicate(
          `${provider.name} records both executable versions`,
          provider.configuration?.(root, process.env).every(
            (row) => row.endsWith("v1.0.0"),
          ) === true,
        );
        TestValidator.predicate(
          `${provider.name} watches source and build inputs`,
          buildInputs(provider, root).length > 0,
        );
        const session = provider.open({
          root,
          command,
          languages: provider.languages,
          options: { cwd: root },
        });
        const refreshed = await session.refresh();
        TestValidator.equals(
          `${provider.name} publishes one whole strict generation`,
          [refreshed.mode, refreshed.generation, refreshed.snapshot.nodes.length],
          ["initial", 1, 1],
        );
        await session.close();
      }

      for (const provider of standardSidecarProviders) {
        const command = provider.resolve(root, process.env);
        TestValidator.predicate(
          `${provider.name} resolves its named sidecar contract`,
          command !== undefined,
        );
        if (command === undefined) {
          throw new Error(`${provider.name}: fixture command did not resolve`);
        }
        TestValidator.predicate(
          `${provider.name} watches source and build inputs`,
          buildInputs(provider, root).length > 0,
        );
        const session = provider.open({
          root,
          command,
          languages: provider.languages,
          options: { cwd: root },
        });
        const refreshed = await session.refresh();
        TestValidator.equals(
          `${provider.name} publishes one whole analyzer generation`,
          [
            refreshed.mode,
            refreshed.generation,
            refreshed.snapshot.provenance.provider,
          ],
          ["initial", 1, provider.name],
        );
        await session.close();
      }

      const emptyRoot = GraphPaths.createTempDirectory(
        "graph-standard-provider-missing-",
      );
      const clang = standardScipProviders.find(
        (provider) => provider.name === "scip-clang",
      )!;
      TestValidator.equals(
        "Clang declines a checkout without a compilation database",
        clang.resolve(emptyRoot, emptyPath()),
        undefined,
      );
      TestValidator.predicate(
        "unavailable standard tools remain explicit configuration facts",
        clang
          .configuration?.(emptyRoot, emptyPath())
          .every((row) => row.endsWith("=unavailable")) === true,
      );

      const failingIndexer = platformExecutable(emptyRoot, "failing-clang");
      const failingDecoder = platformExecutable(emptyRoot, "failing-scip");
      writeFailingShim(failingIndexer);
      writeFailingShim(failingDecoder);
      fs.writeFileSync(path.join(emptyRoot, "compile_commands.json"), "[]\n");
      TestValidator.predicate(
        "failing standard version probes are reported as unavailable",
        clang
          .configuration?.(emptyRoot, {
            ...emptyPath(),
            SAMCHON_GRAPH_SCIP_CLANG: failingIndexer,
            SAMCHON_GRAPH_SCIP: failingDecoder,
          })
          .every((row) => row.endsWith("=unavailable")) === true,
      );

      const decoder = process.env.SAMCHON_GRAPH_SCIP;
      const searchPath = process.env.PATH;
      const searchPathAlias = process.env.Path;
      delete process.env.SAMCHON_GRAPH_SCIP;
      process.env.PATH = "";
      process.env.Path = "";
      try {
        TestValidator.error(
          "a decoder disappearing after selection refuses to open the slice",
          () =>
            clang.open({
              root: emptyRoot,
              command: {
                command: process.execPath,
                args: [
                  GraphPaths.fakeStandardProvider,
                  "--producer=scip-clang",
                ],
              },
              languages: clang.languages,
              options: { cwd: emptyRoot },
            }),
        );
      } finally {
        if (decoder !== undefined) process.env.SAMCHON_GRAPH_SCIP = decoder;
        if (searchPath === undefined) delete process.env.PATH;
        else process.env.PATH = searchPath;
        if (searchPathAlias === undefined) delete process.env.Path;
        else process.env.Path = searchPathAlias;
      }
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  };

function buildInputs(
  provider: (typeof standardScipProviders)[number],
  root: string,
): readonly string[] {
  return typeof provider.buildInputs === "function"
    ? provider.buildInputs(root)
    : (provider.buildInputs ?? []);
}

function writeProject(root: string): void {
  const files: Record<string, string> = {
    "compile_commands.json": "[]\n",
    "CMakeLists.txt": "project(fixture)\n",
    "pom.xml": "<project />\n",
    "global.json": "{}\n",
    "pyproject.toml": "[project]\nname = \"fixture\"\n",
    Gemfile: "source \"https://example.invalid\"\n",
    "Package.swift": "// swift-tools-version: 6.0\n",
    "build.zig": "pub fn build() void {}\n",
    "composer.json": "{}\n",
    ".luarc.json": "{}\n",
    "pubspec.yaml": "name: fixture\n",
    "src/main.c": "int main(void) { return 0; }\n",
    "src/main.cpp": "int main() { return 0; }\n",
    "src/Main.java": "class Main {}\n",
    "src/Main.kt": "class Main\n",
    "src/Main.scala": "class Main\n",
    "src/Main.cs": "class Main {}\n",
    "src/main.py": "def main(): pass\n",
    "src/main.rb": "def main; end\n",
    "src/Main.swift": "func main() {}\n",
    "src/main.zig": "pub fn main() void {}\n",
    "src/main.php": "<?php function main() {}\n",
    "src/main.lua": "function main() end\n",
    "src/main.dart": "void main() {}\n",
  };
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }
}

function platformExecutable(directory: string, command: string): string {
  return path.join(
    directory,
    process.platform === "win32" ? `${command}.cmd` : command,
  );
}

function writeShim(file: string, producer: string): void {
  const fixture = GraphPaths.fakeStandardProvider;
  fs.writeFileSync(
    file,
    process.platform === "win32"
      ? [
          "@echo off",
          `"${process.execPath}" "${fixture}" "--producer=${producer}" %*`,
          "",
        ].join("\r\n")
      : [
          "#!/bin/sh",
          `exec "${process.execPath}" "${fixture}" "--producer=${producer}" "$@"`,
          "",
        ].join("\n"),
  );
  fs.chmodSync(file, 0o755);
}

function writeFailingShim(file: string): void {
  fs.writeFileSync(
    file,
    process.platform === "win32"
      ? "@exit /b 1\r\n"
      : "#!/bin/sh\nexit 1\n",
  );
  fs.chmodSync(file, 0o755);
}

function emptyPath(): NodeJS.ProcessEnv {
  return {
    PATH: "",
    Path: "",
    PATHEXT: ".EXE;.CMD;.BAT",
    SystemRoot: process.env.SystemRoot,
  };
}
