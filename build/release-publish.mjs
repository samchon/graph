import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Publish the one inspected tarball matching the authorized package/version. */
const root = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const directory = path.join(root, ".release");
const packageName = process.env.RELEASE_PACKAGE ?? "";
const version = process.env.RELEASE_VERSION ?? "";

if (packageName === "" || version === "") {
  throw new Error(
    "release: RELEASE_PACKAGE and RELEASE_VERSION are both required",
  );
}

const matches = fs
  .readdirSync(directory)
  .filter((entry) => entry.endsWith(".tgz"))
  .map((entry) => path.join(directory, entry))
  .filter((tarball) => {
    const manifest = JSON.parse(
      execFileSync("tar", ["-xOzf", path.basename(tarball), "package/package.json"], {
        cwd: path.dirname(tarball),
        encoding: "utf8",
      }),
    );
    return manifest.name === packageName && manifest.version === version;
  });

if (matches.length !== 1) {
  throw new Error(
    `release: expected one inspected tarball for ${packageName}@${version}, found ${String(matches.length)}`,
  );
}

execFileSync(
  "npm",
  ["publish", matches[0], "--access", "public", "--provenance", "--tag", "latest"],
  {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);
