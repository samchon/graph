import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Install and execute either the two exact pre-publication tarballs or the
 * matching registry release in an otherwise empty consumer project.
 */
const version = process.env.RELEASE_VERSION ?? "";
const tarballDirectory = process.env.RELEASE_TARBALL_DIRECTORY;
if (tarballDirectory === undefined && version === "") {
  throw new Error(
    "release: RELEASE_VERSION or RELEASE_TARBALL_DIRECTORY is required",
  );
}

const local = tarballDirectory === undefined
  ? undefined
  : localArtifacts(path.resolve(tarballDirectory));
const expectedVersion = local?.version ?? version;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-smoke-"));

try {
  fs.writeFileSync(
    path.join(directory, "package.json"),
    `${JSON.stringify({ name: "smoke", private: true, type: "module" }, null, 2)}\n`,
  );

  const install = local === undefined
    ? [`@samchon/graph@${expectedVersion}`]
    : [local.sitter, local.graph];
  const npm = npmInvocation();
  run(
    npm.command,
    [
      ...npm.args,
      "install",
      "--no-audit",
      "--no-fund",
      "--no-package-lock",
      ...install,
    ],
    directory,
  );

  const installedSitter = path.join(
    directory,
    "node_modules",
    "@samchon",
    "graph-sitter",
    "package.json",
  );
  if (!fs.existsSync(installedSitter)) {
    throw new Error(
      "release: installing @samchon/graph did not bring @samchon/graph-sitter with it",
    );
  }

  fs.writeFileSync(
    path.join(directory, "smoke.mjs"),
    [
      "import { SamchonGraphMemory, SamchonGraphApplication, parseGraphDump } from '@samchon/graph';",
      "if (typeof SamchonGraphMemory !== 'function') throw new Error('SamchonGraphMemory is not exported');",
      "if (typeof SamchonGraphApplication !== 'function') throw new Error('SamchonGraphApplication is not exported');",
      "if (typeof parseGraphDump !== 'function') throw new Error('parseGraphDump is not exported');",
      "console.log('release: import smoke passed');",
      "",
    ].join("\n"),
  );
  run(process.execPath, ["smoke.mjs"], directory);

  const graphBin = path.join(
    directory,
    "node_modules",
    "@samchon",
    "graph",
    "lib",
    "bin.js",
  );
  run(process.execPath, [graphBin, "--help"], directory);

  const fixture = path.join(directory, "consumer");
  fs.mkdirSync(fixture);
  fs.writeFileSync(
    path.join(fixture, "index.ts"),
    "export function releaseSmoke(): string { return 'ok'; }\n",
  );
  const graphFile = path.join(directory, "graph.json");
  const dumped = execFileSync(
    process.execPath,
    [
      graphBin,
      "dump",
      "--mode",
      "static",
      "--language",
      "typescript",
      "--cwd",
      fixture,
    ],
    {
      cwd: directory,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const parsed = JSON.parse(dumped);
  if (
    parsed.project !== path.resolve(fixture) ||
    !parsed.languages.includes("typescript") ||
    !parsed.nodes.some((node) => node.name === "releaseSmoke")
  ) {
    throw new Error("release: packaged CLI did not produce a valid graph dump");
  }
  fs.writeFileSync(graphFile, dumped);

  await assertMcpHandshake(graphBin, graphFile, expectedVersion, directory);
  await assertViewer(graphBin, graphFile, directory);

  if (local !== undefined) {
    await assertPackagedGoFallback(
      graphBin,
      fixture,
      directory,
      process.env.RELEASE_SCIP_GO,
    );
  }
  process.stdout.write(
    `release: ${local === undefined ? "registry" : "exact local tarball"} smoke passed\n`,
  );
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

function localArtifacts(directory) {
  const found = new Map();
  for (const entry of fs.readdirSync(directory)) {
    if (!entry.endsWith(".tgz")) continue;
    const tarball = path.join(directory, entry);
    const manifest = JSON.parse(
      execFileSync(
        "tar",
        ["-xOzf", entry, "package/package.json"],
        { cwd: directory, encoding: "utf8" },
      ),
    );
    if (found.has(manifest.name)) {
      throw new Error(`release: duplicate tarball for ${manifest.name}`);
    }
    found.set(manifest.name, { manifest, tarball });
  }
  const sitter = found.get("@samchon/graph-sitter");
  const graph = found.get("@samchon/graph");
  if (found.size !== 2 || sitter === undefined || graph === undefined) {
    throw new Error(
      "release: local smoke requires exactly the graph and graph-sitter tarballs",
    );
  }
  if (sitter.manifest.version !== graph.manifest.version) {
    throw new Error("release: packed package versions do not match");
  }
  if (
    graph.manifest.dependencies?.["@samchon/graph-sitter"] !==
    sitter.manifest.version
  ) {
    throw new Error(
      "release: graph tarball did not rewrite its workspace dependency to the exact packed graph-sitter version",
    );
  }
  return {
    version: graph.manifest.version,
    graph: graph.tarball,
    sitter: sitter.tarball,
  };
}

async function assertMcpHandshake(bin, graphFile, version, cwd) {
  const child = spawn(
    process.execPath,
    [bin, "--graph-file", graphFile],
    { cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
  );
  try {
    const response = responseWithId(child, 1);
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "release-smoke", version: "1.0.0" },
        },
      })}\n`,
    );
    const initialized = await response;
    if (
      initialized.result?.serverInfo?.name !== "samchon-graph" ||
      initialized.result?.serverInfo?.version !== version
    ) {
      throw new Error(
        `release: MCP handshake reported ${JSON.stringify(initialized.result?.serverInfo)}`,
      );
    }
  } finally {
    await stop(child);
  }
}

function responseWithId(child, id) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(
      () => reject(new Error("release: MCP handshake timed out")),
      15_000,
    );
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) return;
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line === "") continue;
        const parsed = JSON.parse(line);
        if (parsed.id !== id) continue;
        clearTimeout(timer);
        resolve(parsed);
        return;
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`release: MCP server exited before handshake (${code})`));
    });
  });
}

async function assertViewer(bin, graphFile, cwd) {
  const child = spawn(
    process.execPath,
    [bin, "view", "--graph-file", graphFile, "--port=0", "--no-open"],
    { cwd, stdio: ["ignore", "ignore", "pipe"], windowsHide: true },
  );
  try {
    const url = await viewerUrl(child);
    const [page, script, graph] = await Promise.all([
      fetch(url),
      fetch(new URL("viewer.js", url)),
      fetch(new URL("graph.json", url)),
    ]);
    if (!page.ok || !script.ok || !graph.ok) {
      throw new Error("release: packaged viewer did not serve all bundled assets");
    }
    const pageText = await page.text();
    const scriptText = await script.text();
    const graphBody = await graph.json();
    if (
      !pageText.includes("<!doctype html>") ||
      !pageText.includes('id="app"') ||
      scriptText.length < 100_000 ||
      !Array.isArray(graphBody.nodes) ||
      !Array.isArray(graphBody.links)
    ) {
      throw new Error("release: packaged viewer assets or graph are malformed");
    }
  } finally {
    await stop(child);
  }
}

function viewerUrl(child) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    const timer = setTimeout(
      () => reject(new Error(`release: viewer startup timed out: ${stderr}`)),
      15_000,
    );
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      const match = /serving the 3D viewer at (http:\/\/127\.0\.0\.1:\d+\/)/.exec(
        stderr,
      );
      if (match === null) return;
      clearTimeout(timer);
      resolve(match[1]);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`release: viewer exited during startup (${code}): ${stderr}`));
    });
  });
}

async function assertPackagedGoFallback(bin, fixture, cwd, scipGo) {
  if (scipGo === undefined || !path.isAbsolute(scipGo) || !fs.existsSync(scipGo)) {
    throw new Error("release: RELEASE_SCIP_GO must name the pinned local scip-go");
  }
  fs.writeFileSync(path.join(fixture, "go.mod"), "module release/smoke\n\ngo 1.25\n");
  fs.writeFileSync(
    path.join(fixture, "main.go"),
    "package smoke\n\nfunc ReleaseGoSmoke() string { return \"ok\" }\n",
  );
  const dumped = execFileSync(
    process.execPath,
    [
      bin,
      "dump",
      "--mode",
      "lsp",
      "--language",
      "go",
      "--cwd",
      fixture,
    ],
    {
      cwd,
      encoding: "utf8",
      env: { ...process.env, SAMCHON_GRAPH_SCIP_GO: scipGo },
      maxBuffer: 64 * 1024 * 1024,
      timeout: 180_000,
    },
  );
  const graph = JSON.parse(dumped);
  if (
    !graph.provenance?.some((row) => row.provider === "samchon-graph-go") ||
    !graph.nodes.some(
      (node) =>
        node.name === "ReleaseGoSmoke" &&
        node.file === "main.go",
    ) ||
    graph.nodes.some((node) =>
      node.file.includes("node_modules/@samchon/graph/sidecars/go")
    )
  ) {
    throw new Error(
      `release: packaged Go source fallback did not index the consumer project: ${JSON.stringify({
        provenance: graph.provenance,
        warnings: graph.warnings,
        nodes: graph.nodes.slice(0, 10).map((node) => ({
          name: node.name,
          file: node.file,
        })),
      })}`,
    );
  }
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
}

function run(command, args, cwd) {
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: false,
  });
}

function npmInvocation() {
  return process.platform === "win32"
    ? {
        command: process.execPath,
        args: [
          path.join(
            path.dirname(process.execPath),
            "node_modules",
            "npm",
            "bin",
            "npm-cli.js",
          ),
        ],
      }
    : { command: "npm", args: [] };
}
