import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const graphPackageRoot = path.join(repositoryRoot, "packages", "graph");

// `os.tmpdir()` is itself a symlink on macOS: it reports `/var/folders/...`,
// which resolves to `/private/var/folders/...`. A fixture root built straight
// from it is therefore not the spelling the system reports back, because the
// paths a test compares against are canonical by construction:
//
//   - POSIX `getcwd(3)` resolves every symlink, so a spawned language server's
//     `process.cwd()` names the real directory, not the one it was spawned with;
//   - Node's `require.resolve` returns realpaths unless `--preserve-symlinks`,
//     so a resolved binary or package manifest is canonical too.
//
// Linux (`/tmp`) and Windows have no such symlink, so an unresolved root only
// diverges on macOS. Canonicalizing the root once, here, keeps every path a
// fixture constructs comparable with the paths the product and the kernel hand
// back — on every platform.
const createTempDirectory = (prefix: string): string =>
  fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));

export const GraphPaths = {
  createTempDirectory,
  fakeCmake: path.join(repositoryRoot, "tests", "test-graph", "src", "internal", "fake-cmake.cjs"),
  fakeLspServer: path.join(repositoryRoot, "tests", "test-graph", "src", "internal", "fake-lsp-server.cjs"),
  fakeTtscGraphServer: path.join(repositoryRoot, "tests", "test-graph", "src", "internal", "fake-ttscgraph-server.cjs"),
  fakePub: path.join(repositoryRoot, "tests", "test-graph", "src", "internal", "fake-pub.cjs"),
  graphBin: path.join(graphPackageRoot, "lib", "bin.js"),
  graphPackageRoot,
  repositoryRoot,
};
