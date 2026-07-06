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

const downloadJson = (url) =>
  new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "samchon-graph-experiment" } }, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`${url} returned ${response.statusCode}`));
          response.resume();
          return;
        }
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
      })
      .on("error", reject);
  });

const downloadFile = (url, file) =>
  new Promise((resolve, reject) => {
    const write = fs.createWriteStream(file);
    https
      .get(url, { headers: { "User-Agent": "samchon-graph-experiment" } }, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`${url} returned ${response.statusCode}`));
          response.resume();
          return;
        }
        response.pipe(write);
        write.on("finish", () => {
          write.close(resolve);
        });
      })
      .on("error", reject);
  });

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
  run("tar", ["-xf", archive, "-C", target, "--strip-components=1"]);
  const link = path.join(binRoot, "zls");
  fs.rmSync(link, { force: true });
  fs.symlinkSync(path.join(target, "zls"), link);
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
  case "java":
    apt(["openjdk-17-jdk", "jdtls"]);
    break;
  case "csharp":
    apt(["dotnet-sdk-8.0"]);
    shell("dotnet tool update --global csharp-ls || dotnet tool install --global csharp-ls");
    appendGithubPath(path.join(os.homedir(), ".dotnet", "tools"));
    break;
  case "kotlin":
    await installKotlinLanguageServer();
    break;
  case "swift":
    run("sourcekit-lsp", ["--version"]);
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
  default:
    throw new Error(`No setup recipe for ${experiment.language}`);
}

console.log(`Prepared ${experiment.language} language server.`);
