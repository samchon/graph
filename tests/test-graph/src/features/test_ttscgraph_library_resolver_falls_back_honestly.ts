import { TestValidator } from "@nestia/e2e";
import { buildLspGraph } from "@samchon/graph";
import fs from "node:fs";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";
import { NodeResolution } from "../internal/NodeResolution";

/**
 * When no strict `ttscgraph` binary is installed, a real (non-injected)
 * `buildLspGraph` run must resolve honestly to nothing and fall back rather than
 * inventing a command — exercising the library's own command-resolution lane,
 * including the project `ttscserver` shim and package-beside search.
 *
 * The run is hermetic: the coverage harness's `NODE_PATH` is neutralized so the
 * product cannot resolve the workspace's own `ttsc` (and its real strict binary)
 * from this throwaway project root, which would spawn a genuine provider instead
 * of exercising the honest fallback and would diverge local runs from CI.
 */
export const test_ttscgraph_library_resolver_falls_back_honestly =
  async (): Promise<void> =>
    NodeResolution.withoutGlobalNodePath(async () => {
      const root = GraphPaths.createTempDirectory("samchon-graph-ttscgraph-libresolve-");
      fs.mkdirSync(path.join(root, "src"), { recursive: true });
      fs.writeFileSync(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true } }));
      fs.writeFileSync(path.join(root, "src", "index.ts"), "export const value = 1;\n");

      // A project `ttscserver` shim with no adjacent `ttscgraph` and no `ttsc`
      // package: resolution must walk the whole project-owned candidate set and
      // still find nothing, leaving the build to fall back honestly.
      const bin = path.join(root, "node_modules", ".bin");
      fs.mkdirSync(bin, { recursive: true });
      const server = path.join(bin, process.platform === "win32" ? "ttscserver.exe" : "ttscserver");
      fs.writeFileSync(server, process.platform === "win32" ? "@echo off\n" : "#!/bin/sh\nexit 0\n");
      if (process.platform !== "win32") fs.chmodSync(server, 0o755);

      const result = await buildLspGraph({ cwd: root, languages: ["typescript"] });
      TestValidator.predicate(
        "a missing strict binary is reported honestly, not resolved to a phantom command",
        result.warnings.some((warning) =>
          warning.includes("ttscgraph bulk provider was not found"),
        ),
      );
      TestValidator.predicate(
        "the build still produces a dump via fallback rather than crashing",
        result.dump.project === path.resolve(root),
      );
    });
