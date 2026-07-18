import ttsc from "@ttsc/unplugin/esbuild";
import { build } from "esbuild";
import { readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

rmSync("lib", { force: true, recursive: true });

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(file);
    return entry.isFile() && file.endsWith(".ts") ? [file] : [];
  });

// A test may reach an internal unit that the package does not re-export — a
// class or helper with no home in `@samchon/graph`'s public surface — by its
// source path. Bundled naively, esbuild inlines a *second* compiled copy of
// that source into the test, and `pnpm coverage` (c8 `--src packages/graph/src`
// with `--exclude-after-remap`) remaps the inlined copy back onto the same
// source as the package's own `lib` copy, merging two count sets that disagree
// and reporting the file below 100% though every line runs. The public
// `@samchon/graph` import avoids this because it is left external and resolves
// to the single `lib` copy at runtime; this plugin extends that treatment to a
// deep source path, rewriting it to the matching built `lib` file and marking
// it external so the one measured copy is the only copy.
const redirectInternalSource = {
  name: "redirect-internal-source-to-lib",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /packages\/graph(?:-sitter)?\/src\// }, (args) => {
      const abs = path.resolve(args.resolveDir, args.path);
      const built = abs
        .replace(`${path.sep}src${path.sep}`, `${path.sep}lib${path.sep}`)
        .replace(/\.(ts|js)$/, "");
      return { path: pathToFileURL(`${built}.js`).href, external: true };
    });
  },
};

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
  plugins: [redirectInternalSource, ttsc({ project: "tsconfig.json", plugins: false })],
  sourcemap: true,
  target: "node22",
});
