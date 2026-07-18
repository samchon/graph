import { TestValidator } from "@nestia/e2e";
import fs from "node:fs";
import path from "node:path";

// `resolveTtscGraphCommand` is internal to the package, so it is reached by path
// rather than through the public barrel.
import { resolveTtscGraphCommand } from "../../../../packages/graph/src/provider/ttscgraph/resolveTtscGraphCommand";
import { GraphPaths } from "../internal/GraphPaths";

/**
 * Command resolution must find the strict binary the project actually owns —
 * through the `ttsc` platform package, a project `ttscserver` shim, or a `.cmd`
 * wrapper — before ever falling back to PATH, and must report `undefined`
 * honestly when nothing is installed rather than inventing a command.
 */
export const test_ttscgraph_command_resolution_prefers_project_binary =
  async () => {
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
      "cmd.exe",
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
    // through a `ttsc` platform package installed beside it.
    const beside = makeDir(path.join(root, "server-beside"));
    writeExecutable(path.join(beside, "node_modules", ".bin", exeName("ttscserver")));
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
  };

function exeName(name: string): string {
  return process.platform === "win32" ? `${name}.exe` : name;
}

function env(binDir: string): NodeJS.ProcessEnv {
  const next = { ...process.env, PATH: binDir };
  delete next.TTSC_GRAPH_BINARY;
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
