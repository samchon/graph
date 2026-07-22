import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Install the published artifacts into an empty directory and use them.
 *
 * This is the only step that proves the release resolves. Everything before it
 * ran inside the workspace, where `@samchon/graph-sitter` is `workspace:*` and
 * therefore always resolves — including in the release that shipped a
 * `@samchon/graph` whose dependency did not exist on the registry at all.
 *
 * Both entry points are exercised, because they fail independently: a broken
 * `bin` still imports, and a broken `exports` map still runs the CLI.
 */
const version = process.env.RELEASE_VERSION ?? "";
if (version === "") {
  throw new Error("release: RELEASE_VERSION is required");
}

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-smoke-"));
try {
  fs.writeFileSync(
    path.join(directory, "package.json"),
    `${JSON.stringify({ name: "smoke", private: true, type: "module" }, null, 2)}\n`,
  );

  run("npm", ["install", "--no-audit", "--no-fund", `@samchon/graph@${version}`], directory);

  const sitter = path.join(
    directory,
    "node_modules",
    "@samchon",
    "graph-sitter",
    "package.json",
  );
  if (!fs.existsSync(sitter)) {
    throw new Error(
      "release: installing @samchon/graph did not bring @samchon/graph-sitter with it",
    );
  }

  fs.writeFileSync(
    path.join(directory, "smoke.mjs"),
    [
      "import { SamchonGraphMemory, SamchonGraphApplication } from '@samchon/graph';",
      "if (typeof SamchonGraphMemory !== 'function') throw new Error('SamchonGraphMemory is not exported');",
      "if (typeof SamchonGraphApplication !== 'function') throw new Error('SamchonGraphApplication is not exported');",
      "console.log('release: import smoke passed');",
      "",
    ].join("\n"),
  );
  run(process.execPath, ["smoke.mjs"], directory);

  run(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["--no-install", "samchon-graph", "--help"],
    directory,
  );
  process.stdout.write("release: clean-install smoke passed\n");
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

function run(command, args, cwd) {
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}
