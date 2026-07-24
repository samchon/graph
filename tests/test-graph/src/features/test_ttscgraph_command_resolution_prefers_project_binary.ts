import { TestValidator } from "@nestia/e2e";
import fs from "node:fs";
import path from "node:path";

// `resolveTtscGraphCommand` is internal to the package, so it is reached by path
// rather than through the public barrel.
import { resolveTtscGraphCommand } from "../../../../packages/graph/src/provider/ttscgraph/resolveTtscGraphCommand";
import { spawnableCommand } from "../../../../packages/graph/src/utils/spawnableCommand";
import { GraphPaths } from "../internal/GraphPaths";
import { NodeResolution } from "../internal/NodeResolution";

/**
 * Command resolution must find the strict binary the project actually owns —
 * through the `ttsc` platform package, a project `ttscserver` shim, or a `.cmd`
 * wrapper — before ever falling back to PATH, and must report `undefined`
 * honestly when nothing is installed rather than inventing a command.
 *
 * Every case is hermetic: it observes only the temporary files it builds. The
 * whole body runs with the coverage harness's `NODE_PATH` neutralized so the
 * product's `ttsc` package lookup cannot silently resolve the workspace's own
 * installation from a throwaway fixture root — that leak would pass locally and
 * abort on CI (or the reverse), depending on which machine ships a real binary.
 */
export const test_ttscgraph_command_resolution_prefers_project_binary =
  async (): Promise<void> =>
    NodeResolution.withoutGlobalNodePath(async () => {
      const root = GraphPaths.createTempDirectory("samchon-graph-ttscgraph-resolve-");
      const platformPackage = `@ttsc/${process.platform}-${process.arch}`;

      // The project's own `ttsc` platform package owns the compatible binary and
      // is preferred above every other candidate.
      const owned = makeDir(path.join(root, "owned-project"));
      writeJson(path.join(owned, "node_modules", "ttsc", "package.json"), { name: "ttsc", version: "0.0.0" });
      writeJson(path.join(owned, "node_modules", platformPackage, "package.json"), {
        name: platformPackage,
        version: "0.0.0",
      });
      const ownedGraph = path.join(owned, "node_modules", platformPackage, "bin", exeName("ttscgraph"));
      writeExecutable(ownedGraph);
      TestValidator.equals(
        "the project's ttsc platform binary is preferred",
        resolveTtscGraphCommand(owned, env(makeDir(path.join(root, "owned-empty"))))?.command,
        ownedGraph,
      );

      // No installation anywhere: resolution reports undefined, exercising the
      // project-package resolution failure and every empty lookup.
      const emptyPath = makeDir(path.join(root, "empty-path"));
      TestValidator.equals(
        "an empty environment resolves no command",
        resolveTtscGraphCommand(makeDir(path.join(root, "empty-project")), env(emptyPath)),
        undefined,
      );

      // A non-absolute override is ignored, and an absolute override that is a
      // directory is not spawnable, both falling through to (here) undefined.
      TestValidator.equals(
        "a relative binary override is ignored",
        resolveTtscGraphCommand(makeDir(path.join(root, "rel-project")), {
          ...env(emptyPath),
          TTSC_GRAPH_BINARY: "relative/ttscgraph",
        }),
        undefined,
      );
      const dirOverride = makeDir(path.join(root, "dir-override"));
      TestValidator.equals(
        "a directory override is not spawnable",
        resolveTtscGraphCommand(makeDir(path.join(root, "dir-project")), {
          ...env(emptyPath),
          TTSC_GRAPH_BINARY: dirOverride,
        }),
        undefined,
      );

      // An absolute `.cmd` override is executed through cmd.exe, not spawned raw.
      const shim = path.join(makeDir(path.join(root, "shim")), "ttscgraph.cmd");
      writeExecutable(shim);
      TestValidator.equals(
        "an absolute .cmd override runs through cmd.exe",
        resolveTtscGraphCommand(makeDir(path.join(root, "shim-project")), {
          ...env(emptyPath),
          TTSC_GRAPH_BINARY: shim,
        })?.command,
        process.platform === "win32"
          ? spawnableCommand.windowsSystem("cmd.exe", {
              ...env(emptyPath),
              TTSC_GRAPH_BINARY: shim,
            })
          : shim,
      );

      // The project has `ttsc` installed but no compatible platform binary: the
      // platform lookup fails and resolution continues past it to undefined.
      const noPlatform = makeDir(path.join(root, "ttsc-no-platform"));
      writeJson(path.join(noPlatform, "node_modules", "ttsc", "package.json"), {
        name: "ttsc",
        version: "0.0.0",
      });
      TestValidator.equals(
        "a ttsc install without a platform binary keeps resolving",
        resolveTtscGraphCommand(noPlatform, env(emptyPath)),
        undefined,
      );

      // A project `ttscserver` shim reveals the strict binary beside it.
      const sibling = makeDir(path.join(root, "server-sibling"));
      writeExecutable(path.join(sibling, "node_modules", ".bin", exeName("ttscserver")));
      const siblingGraph = path.join(sibling, "node_modules", ".bin", exeName("ttscgraph"));
      writeExecutable(siblingGraph);
      TestValidator.equals(
        "a project ttscserver shim reveals its sibling ttscgraph",
        resolveTtscGraphCommand(sibling, env(emptyPath))?.command,
        siblingGraph,
      );

      // A project `ttscserver` shim with no sibling still reveals a strict binary
      // through a `ttsc` platform package installed beside it. A decoy `ttsc`
      // package one directory up — resolvable but missing its platform binary —
      // is skipped so the search continues to the real one, exercising the
      // "candidate exists but yields no strict binary" step of the walk.
      const beside = makeDir(path.join(root, "server-beside"));
      writeExecutable(path.join(beside, "node_modules", ".bin", exeName("ttscserver")));
      writeJson(path.join(beside, "node_modules", "ttsc", "package.json"), {
        name: "ttsc",
        version: "0.0.0",
      });
      writeJson(
        path.join(beside, "node_modules", ".bin", "node_modules", "ttsc", "package.json"),
        { name: "ttsc", version: "0.0.0" },
      );
      writeJson(
        path.join(beside, "node_modules", ".bin", "node_modules", platformPackage, "package.json"),
        { name: platformPackage, version: "0.0.0" },
      );
      const besideGraph = path.join(
        beside,
        "node_modules",
        ".bin",
        "node_modules",
        platformPackage,
        "bin",
        exeName("ttscgraph"),
      );
      writeExecutable(besideGraph);
      TestValidator.equals(
        "a ttsc platform package beside the server reveals its ttscgraph",
        resolveTtscGraphCommand(beside, env(emptyPath))?.command,
        besideGraph,
      );

      // A project `ttscserver` shim with neither a sibling nor a ttsc package
      // resolves nothing, and the identical global candidate cannot rescue it.
      const orphan = makeDir(path.join(root, "server-orphan"));
      const orphanBin = makeDir(path.join(orphan, "node_modules", ".bin"));
      writeExecutable(path.join(orphanBin, exeName("ttscserver")));
      TestValidator.equals(
        "an orphan ttscserver shim resolves no strict binary",
        resolveTtscGraphCommand(orphan, env(orphanBin)),
        undefined,
      );

      // A `ttscgraph` found only on the global PATH is the last-resort fallback.
      const globalGraphBin = makeDir(path.join(root, "global-graph"));
      const globalGraph = path.join(globalGraphBin, exeName("ttscgraph"));
      writeExecutable(globalGraph);
      TestValidator.equals(
        "a global ttscgraph is used only as a fallback",
        resolveTtscGraphCommand(makeDir(path.join(root, "global-graph-project")), env(globalGraphBin))?.command,
        globalGraph,
      );

      // A `ttscserver` found only on the global PATH reveals its sibling ttscgraph.
      const globalServerBin = makeDir(path.join(root, "global-server"));
      writeExecutable(path.join(globalServerBin, exeName("ttscserver")));
      const globalServerGraph = path.join(globalServerBin, exeName("ttscgraph"));
      writeExecutable(globalServerGraph);
      TestValidator.equals(
        "a global ttscserver reveals its sibling ttscgraph as a fallback",
        resolveTtscGraphCommand(makeDir(path.join(root, "global-server-project")), env(globalServerBin))?.command,
        globalServerGraph,
      );

      // A global `ttscserver` with NO adjacent `ttscgraph` still reveals the strict
      // binary through a `ttsc` platform package beside it. Because PATH yields no
      // direct `ttscgraph`, this is the only path that reaches the global-server
      // fallback and asks it to search the packages beside that server.
      const globalPkgBin = makeDir(path.join(root, "global-server-pkg"));
      writeExecutable(path.join(globalPkgBin, exeName("ttscserver")));
      writeJson(path.join(globalPkgBin, "node_modules", "ttsc", "package.json"), {
        name: "ttsc",
        version: "0.0.0",
      });
      writeJson(path.join(globalPkgBin, "node_modules", platformPackage, "package.json"), {
        name: platformPackage,
        version: "0.0.0",
      });
      const globalPkgGraph = path.join(
        globalPkgBin,
        "node_modules",
        platformPackage,
        "bin",
        exeName("ttscgraph"),
      );
      writeExecutable(globalPkgGraph);
      TestValidator.equals(
        "a global ttscserver reveals a ttscgraph through a ttsc package beside it",
        resolveTtscGraphCommand(makeDir(path.join(root, "global-server-pkg-project")), env(globalPkgBin))?.command,
        globalPkgGraph,
      );

      // An environment with no PATH at all resolves cleanly rather than throwing:
      // the global lookups coalesce the absent PATH to an empty search string.
      const noPathEnv = env(makeDir(path.join(root, "no-path-ignored")));
      delete noPathEnv.PATH;
      TestValidator.equals(
        "a missing PATH resolves no command without throwing",
        resolveTtscGraphCommand(makeDir(path.join(root, "no-path-project")), noPathEnv),
        undefined,
      );

      // A resolvable platform binary that is not executable is rejected as
      // unspawnable rather than trusted. Windows does not model an execute bit, so
      // any regular file is spawnable there; the negative is a POSIX invariant.
      const nonExec = makeDir(path.join(root, "ttsc-nonexec"));
      writeJson(path.join(nonExec, "node_modules", "ttsc", "package.json"), {
        name: "ttsc",
        version: "0.0.0",
      });
      writeJson(path.join(nonExec, "node_modules", platformPackage, "package.json"), {
        name: platformPackage,
        version: "0.0.0",
      });
      const nonExecGraph = path.join(nonExec, "node_modules", platformPackage, "bin", exeName("ttscgraph"));
      fs.mkdirSync(path.dirname(nonExecGraph), { recursive: true });
      fs.writeFileSync(nonExecGraph, process.platform === "win32" ? "@echo off\n" : "#!/bin/sh\n");
      const nonExecEnv = env(makeDir(path.join(root, "nonexec-empty")));
      if (process.platform === "win32")
        TestValidator.equals(
          "windows spawns a regular platform binary regardless of an execute bit",
          resolveTtscGraphCommand(nonExec, nonExecEnv)?.command,
          nonExecGraph,
        );
      else
        TestValidator.equals(
          "a non-executable platform binary is not spawnable",
          resolveTtscGraphCommand(nonExec, nonExecEnv),
          undefined,
        );
    });

function exeName(name: string): string {
  return process.platform === "win32" ? `${name}.exe` : name;
}

function env(binDir: string): NodeJS.ProcessEnv {
  // Strip every case-spelling of PATH before installing the isolated one.
  // Windows resolves environment names case-insensitively, yet Node's
  // `process.env` exposes each spelling as its own key, so a package manager's
  // injected `Path` would survive a plain `PATH` override and let the product's
  // `where.exe` lookup discover an ambient `ttscgraph` — passing locally while a
  // clean CI machine (single `PATH`, no ambient binary) resolves nothing. Drop
  // all spellings so the fixture PATH is the only search root on every platform.
  const next: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    const upper = key.toUpperCase();
    if (upper === "PATH" || upper === "TTSC_GRAPH_BINARY") continue;
    next[key] = value;
  }
  next.PATH = binDir;
  return next;
}

function makeDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeExecutable(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, process.platform === "win32" ? "@echo off\n" : "#!/bin/sh\n");
  if (process.platform !== "win32") fs.chmodSync(file, 0o755);
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}
