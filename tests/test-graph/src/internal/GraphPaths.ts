import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const graphPackageRoot = path.join(repositoryRoot, "packages", "graph");

// `os.tmpdir()` does not report the canonical spelling of the temp root on
// every platform, yet the paths a test compares against are canonical by
// construction:
//
//   - POSIX `getcwd(3)` resolves every symlink, so a spawned language server's
//     `process.cwd()` names the real directory, not the one it was spawned with;
//   - Node's `require.resolve` returns realpaths unless `--preserve-symlinks`,
//     so a resolved binary or package manifest is canonical too;
//   - Windows `where.exe` (and the kernel generally) reports the long-form path
//     of an executable, never an 8.3 short name.
//
// Two spellings diverge from a raw `os.tmpdir()` root:
//
//   - macOS: `os.tmpdir()` is a symlink (`/var/folders/...` ->
//     `/private/var/folders/...`);
//   - Windows: `TMP`/`TEMP` — and therefore `os.tmpdir()` — is commonly the 8.3
//     short form (the GitHub `windows-latest` runner reports
//     `C:\Users\RUNNER~1\AppData\Local\Temp`, aliasing `runneradmin`).
//
// The default `fs.realpathSync` is a JS implementation that resolves symlinks
// but does NOT expand 8.3 short names, so it leaves the Windows divergence in
// place — a fixture path would keep `RUNNER~1` while the product, resolving the
// same binary through `where.exe`, reports the long `runneradmin`, and the two
// would compare unequal only on CI. `fs.realpathSync.native` delegates to the OS
// realpath, which resolves symlinks AND expands short names, canonicalizing the
// root once so every path a fixture constructs stays comparable with the paths
// the product and the kernel hand back — on every platform.
const createTempDirectory = (prefix: string): string =>
  fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));

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
