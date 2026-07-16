import ttsc from "@ttsc/unplugin/esbuild";
import { build } from "esbuild";
import { readdirSync, rmSync } from "node:fs";
import path from "node:path";

rmSync("lib", { force: true, recursive: true });

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(file);
    return entry.isFile() && file.endsWith(".ts") ? [file] : [];
  });

await build({
  bundle: true,
  entryNames: "[dir]/[name]",
  entryPoints: ["src/index.ts", ...walk("src/features")],
  external: [
    "@modelcontextprotocol/sdk/*",
    "@nestia/e2e",
    "@samchon/graph",
    "@samchon/graph-sitter",
  ],
  format: "esm",
  logLevel: "info",
  outdir: "lib",
  outExtension: { ".js": ".mjs" },
  outbase: "src",
  platform: "node",
  plugins: [ttsc({ project: "tsconfig.json", plugins: false })],
  sourcemap: true,
  target: "node22",
});
