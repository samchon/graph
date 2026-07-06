import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const graphPackageRoot = path.join(repositoryRoot, "packages", "graph");

export const GraphPaths = {
  fakeLspServer: path.join(repositoryRoot, "test", "src", "internal", "fake-lsp-server.cjs"),
  graphBin: path.join(graphPackageRoot, "lib", "bin.js"),
  graphPackageRoot,
  repositoryRoot,
};
