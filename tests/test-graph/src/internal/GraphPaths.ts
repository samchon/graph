import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const graphPackageRoot = path.join(repositoryRoot, "packages", "graph");

export const GraphPaths = {
  fakeCmake: path.join(repositoryRoot, "tests", "test-graph", "src", "internal", "fake-cmake.cjs"),
  fakeLspServer: path.join(repositoryRoot, "tests", "test-graph", "src", "internal", "fake-lsp-server.cjs"),
  fakeTtscGraphServer: path.join(repositoryRoot, "tests", "test-graph", "src", "internal", "fake-ttscgraph-server.cjs"),
  fakePub: path.join(repositoryRoot, "tests", "test-graph", "src", "internal", "fake-pub.cjs"),
  graphBin: path.join(graphPackageRoot, "lib", "bin.js"),
  graphPackageRoot,
  repositoryRoot,
};
