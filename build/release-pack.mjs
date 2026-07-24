import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifyTarballContents } from "./release-preflight.mjs";

const root = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const output = path.join(root, ".release");

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

/** Tarballs already inspected, so each pack is matched to its own artifact. */
const inspected = new Set();

for (const directory of fs
  .readdirSync(path.join(root, "packages"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())) {
  const location = path.join(root, "packages", directory.name);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(location, "package.json"), "utf8"),
  );
  if (manifest.private === true) continue;

  execFileSync("pnpm", ["pack", "--pack-destination", output], {
    cwd: location,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  const tarball = fs
    .readdirSync(output)
    .map((entry) => path.join(output, entry))
    .find((entry) => entry.endsWith(".tgz") && !inspected.has(entry));
  if (tarball === undefined) {
    throw new Error(`release: ${manifest.name} produced no tarball`);
  }
  inspected.add(tarball);

  const entries = execFileSync("tar", ["-tzf", path.basename(tarball)], {
    cwd: path.dirname(tarball),
    encoding: "utf8",
  })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.endsWith("/"));

  const packed = verifyTarballContents({
    name: manifest.name,
    files: manifest.files,
    entries,
  });
  process.stdout.write(
    `release: ${manifest.name} packs ${String(packed.length)} entries\n`,
  );
}
