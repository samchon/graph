import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";

import { findExperiment } from "./catalog.mjs";
import { appendGithubPath, ensureDir, parseArgs, run, shell, workRoot } from "./process.mjs";

const args = parseArgs(process.argv.slice(2));
const experiment = findExperiment(args.language);
const toolsRoot = path.join(workRoot, "tools");
const binRoot = path.join(toolsRoot, "bin");
ensureDir(binRoot);
appendGithubPath(binRoot);

const apt = (packages) => {
  shell("sudo apt-get update");
  shell(`sudo apt-get install -y ${packages.join(" ")}`);
};

// GitHub release download URLs (and coursier/eclipse mirrors) answer with a 302
// to a CDN host, so follow redirects instead of treating them as failures.
const openStream = (url, redirects = 0) =>
  new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "samchon-graph-experiment" } }, (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          if (redirects >= 5) {
            reject(new Error(`Too many redirects for ${url}`));
            return;
          }
          resolve(openStream(new URL(response.headers.location, url).toString(), redirects + 1));
          return;
        }
        if (status !== 200) {
          reject(new Error(`${url} returned ${status}`));
          response.resume();
          return;
        }
        resolve(response);
      })
      .on("error", reject);
  });

const downloadJson = async (url) => {
  const response = await openStream(url);
  const chunks = [];
  return await new Promise((resolve, reject) => {
    response.on("data", (chunk) => chunks.push(chunk));
    response.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
    response.on("error", reject);
  });
};

const downloadFile = async (url, file) => {
  const response = await openStream(url);
  await new Promise((resolve, reject) => {
    const write = fs.createWriteStream(file);
    response.pipe(write);
    write.on("finish", () => write.close(resolve));
    write.on("error", reject);
  });
};

const latestAsset = async (repository, pattern) => {
  const release = await downloadJson(`https://api.github.com/repos/${repository}/releases/latest`);
  const asset = release.assets.find((item) => pattern.test(item.name));
  if (asset === undefined) throw new Error(`No release asset matching ${pattern} in ${repository}`);
  return asset.browser_download_url;
};

const installKotlinLanguageServer = async () => {
  apt(["openjdk-17-jdk", "unzip"]);
  const url = await latestAsset("fwcd/kotlin-language-server", /server.*\.zip$/);
  const archive = path.join(toolsRoot, "kotlin-language-server.zip");
  const target = path.join(toolsRoot, "kotlin-language-server");
  await downloadFile(url, archive);
  fs.rmSync(target, { force: true, recursive: true });
  ensureDir(target);
  run("unzip", ["-q", archive, "-d", target]);
  const launcher = path.join(target, "server", "bin", "kotlin-language-server");
  const link = path.join(binRoot, "kotlin-language-server");
  fs.rmSync(link, { force: true });
  fs.symlinkSync(launcher, link);
};

const installZls = async () => {
  const url = await latestAsset("zigtools/zls", /x86_64.*linux.*\.tar\.xz$/);
  const archive = path.join(toolsRoot, "zls.tar.xz");
  const target = path.join(toolsRoot, "zls");
  await downloadFile(url, archive);
  fs.rmSync(target, { force: true, recursive: true });
  ensureDir(target);
  // Recent zls tarballs extract the `zls` binary at the archive root, so no
  // `--strip-components`; locate the binary wherever it lands.
  run("tar", ["-xf", archive, "-C", target]);
  const binary = findFile(target, "zls");
  if (binary === undefined) throw new Error("zls binary not found after extraction");
  fs.chmodSync(binary, 0o755);
  const link = path.join(binRoot, "zls");
  fs.rmSync(link, { force: true });
  fs.symlinkSync(binary, link);
};

const findFile = (dir, name) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = findFile(abs, name);
      if (nested !== undefined) return nested;
    } else if (entry.name === name) {
      return abs;
    }
  }
  return undefined;
};

switch (experiment.language) {
  case "typescript":
  case "javascript":
    break;
  case "go":
    apt(["golang-go"]);
    shell("go install golang.org/x/tools/gopls@latest");
    appendGithubPath(path.join(os.homedir(), "go", "bin"));
    break;
  case "rust":
    shell("curl https://sh.rustup.rs -sSf | sh -s -- -y --profile minimal");
    appendGithubPath(path.join(os.homedir(), ".cargo", "bin"));
    shell(`${path.join(os.homedir(), ".cargo", "bin", "rustup")} component add rust-analyzer`);
    break;
  case "cpp":
  case "c":
    apt(["clangd"]);
    break;
  case "java": {
    // jdtls is not an apt package and requires Java 21+; install the JDK and the
    // Eclipse JDT.LS snapshot tarball, then put its bin on PATH. The launcher is
    // a Python script that locates its plugins relative to its own path, so it
    // must run from the extracted tree rather than a symlink.
    apt(["openjdk-21-jdk", "python3"]);
    // jdtls crashes on the runner's default JDK; point it at Java 21.
    const javaHome = "/usr/lib/jvm/java-21-openjdk-amd64";
    process.env.JAVA_HOME = javaHome;
    if (process.env.GITHUB_ENV !== undefined) {
      fs.appendFileSync(process.env.GITHUB_ENV, `JAVA_HOME=${javaHome}${os.EOL}`);
    }
    appendGithubPath(path.join(javaHome, "bin"));
    const target = path.join(toolsRoot, "jdtls");
    const archive = path.join(toolsRoot, "jdtls.tar.gz");
    await downloadFile(
      "https://download.eclipse.org/jdtls/snapshots/jdt-language-server-latest.tar.gz",
      archive,
    );
    fs.rmSync(target, { force: true, recursive: true });
    ensureDir(target);
    run("tar", ["-xzf", archive, "-C", target]);
    appendGithubPath(path.join(target, "bin"));
    break;
  }
  case "csharp": {
    // `dotnet-sdk-9.0` is not an apt package on Ubuntu 24.04; use the official
    // install script. Latest csharp-ls targets .NET 9.
    const dotnetHome = path.join(os.homedir(), ".dotnet");
    const dotnet = path.join(dotnetHome, "dotnet");
    shell("curl -fsSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh");
    // 8.0 runs csharp-ls 0.20.0 (a net8 tool); 10.0 satisfies the fixture's
    // global.json SDK pin so `dotnet restore` can load the solution.
    shell("bash /tmp/dotnet-install.sh --channel 8.0");
    shell("bash /tmp/dotnet-install.sh --channel 10.0");
    appendGithubPath(dotnetHome);
    appendGithubPath(path.join(dotnetHome, "tools"));
    // csharp-ls 0.21.0 ships a broken package ("DotnetToolSettings.xml was not
    // found", razzmatazz/csharp-language-server#305); pin the last version that
    // installs.
    shell(`"${dotnet}" tool install --global csharp-ls --version 0.20.0 || "${dotnet}" tool update --global csharp-ls --version 0.20.0`);
    break;
  }
  case "kotlin":
    await installKotlinLanguageServer();
    break;
  case "swift":
    // sourcekit-lsp ships with the toolchain installed by the workflow's Setup
    // Swift step. It has no `--version` flag (that exits 64), so just confirm it
    // resolves on PATH.
    shell("command -v sourcekit-lsp");
    break;
  case "scala":
    apt(["openjdk-17-jdk", "gzip"]);
    await downloadFile("https://github.com/coursier/coursier/releases/latest/download/cs-x86_64-pc-linux.gz", path.join(toolsRoot, "cs.gz"));
    shell(`gzip -dc "${path.join(toolsRoot, "cs.gz")}" > "${path.join(binRoot, "cs")}"`);
    shell(`chmod +x "${path.join(binRoot, "cs")}"`);
    run(path.join(binRoot, "cs"), ["install", "metals"]);
    appendGithubPath(path.join(os.homedir(), ".local", "share", "coursier", "bin"));
    break;
  case "zig":
    await installZls();
    break;
  case "python":
    shell("npm install -g pyright");
    break;
  case "ruby":
    // The runner ships ruby but not bundler, which both the fixture's
    // `bundle install` prepare step and ruby-lsp's composed bundle need.
    shell("sudo gem install bundler ruby-lsp");
    break;
  case "php":
    shell("npm install -g intelephense");
    break;
  case "lua": {
    const url = await latestAsset("LuaLS/lua-language-server", /linux-x64\.tar\.gz$/);
    const archive = path.join(toolsRoot, "lua-language-server.tar.gz");
    const target = path.join(toolsRoot, "lua-language-server");
    await downloadFile(url, archive);
    fs.rmSync(target, { force: true, recursive: true });
    ensureDir(target);
    run("tar", ["-xzf", archive, "-C", target]);
    appendGithubPath(path.join(target, "bin"));
    break;
  }
  case "bash":
    shell("npm install -g bash-language-server");
    break;
  case "dart": {
    const archive = path.join(toolsRoot, "dartsdk.zip");
    const target = path.join(toolsRoot, "dart-sdk-root");
    await downloadFile(
      "https://storage.googleapis.com/dart-archive/channels/stable/release/latest/sdk/dartsdk-linux-x64-release.zip",
      archive,
    );
    fs.rmSync(target, { force: true, recursive: true });
    ensureDir(target);
    run("unzip", ["-q", archive, "-d", target]);
    appendGithubPath(path.join(target, "dart-sdk", "bin"));
    break;
  }
  default:
    throw new Error(`No setup recipe for ${experiment.language}`);
}

console.log(`Prepared ${experiment.language} language server.`);
