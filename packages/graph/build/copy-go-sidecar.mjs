import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repositoryRoot = path.resolve(packageRoot, "..", "..");
const source = path.join(repositoryRoot, "sidecars", "go");
const target = path.join(packageRoot, "sidecars", "go");

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
for (const file of [
  "analyze.go",
  "go.mod",
  "go.sum",
  "main.go",
  "model.go",
  "modules.go",
  "scip.go",
]) {
  fs.copyFileSync(path.join(source, file), path.join(target, file));
}
