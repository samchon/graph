// Bundle the standalone 3D viewer (three + three-forcegraph + the viewer code)
// into a single self-contained IIFE so `samchon-graph view` can serve it with no
// runtime npm dependency. three / three-forcegraph are devDependencies: only
// this built artifact ships in the package.
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "lib", "viewer");
fs.mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [path.join(root, "src", "viewer", "main.ts")],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  legalComments: "none",
  outfile: path.join(outDir, "viewer.js"),
});
fs.copyFileSync(
  path.join(root, "src", "viewer", "index.html"),
  path.join(outDir, "index.html"),
);

const bytes = fs.statSync(path.join(outDir, "viewer.js")).size;
console.log(`bundled viewer: ${(bytes / 1024).toFixed(0)} KB`);
