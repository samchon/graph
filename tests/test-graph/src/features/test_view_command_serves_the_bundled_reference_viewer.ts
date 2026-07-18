import { TestValidator } from "@nestia/e2e";
import { ChildProcess, spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";

export const test_view_command_serves_the_bundled_reference_viewer = async () => {
  const root = GraphPaths.createTempDirectory("samchon-graph-view-");
  const graphFile = path.join(root, "graph.json");
  await fs.writeFile(
    graphFile,
    JSON.stringify({
      project: "fixture",
      nodes: [
        { id: "a.ts#A:class", name: "A", kind: "class", file: "a.ts" },
        { id: "b.ts#B:function", name: "B", kind: "function", file: "b.ts" },
      ],
      edges: [{ from: "a.ts#A:class", to: "b.ts#B:function", kind: "calls" }],
    }),
  );
  const port = await freePort();
  const child = spawn(
    process.execPath,
    [
      GraphPaths.graphBin,
      "view",
      `--graph-file=${graphFile}`,
      `--cwd=${root}`,
      `--port=${port}`,
      "--no-open",
      "--max-nodes=10",
    ],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  try {
    await waitUntilServing(child);
    const graph = JSON.parse(await get(`http://127.0.0.1:${port}/graph.json?cache=off`));
    TestValidator.equals("the HTTP payload carries the reduced graph", graph.counts, {
      rawNodes: 2,
      rawEdges: 1,
      nodes: 2,
      links: 1,
      droppedExternal: 0,
      droppedByCap: 0,
    });
    TestValidator.equals("the view names the requested cwd", graph.project, path.basename(root));
    TestValidator.predicate(
      "the bundled viewer JavaScript is substantial",
      (await get(`http://127.0.0.1:${port}/viewer.js`)).length > 100_000,
    );
    const html = await get(`http://127.0.0.1:${port}/anything`);
    TestValidator.predicate("fallback routes serve the viewer shell", html.includes("viewer.js"));
  } finally {
    child.kill();
    await fs.rm(root, { recursive: true, force: true });
  }
};

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });

const waitUntilServing = (child: ChildProcess): Promise<void> =>
  new Promise((resolve, reject) => {
    let stderr = "";
    const timer = setTimeout(() => reject(new Error(`viewer did not start:\n${stderr}`)), 15_000);
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.includes("serving the 3D viewer")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`viewer exited before serving (${code}):\n${stderr}`));
    });
    child.once("error", reject);
  });

const get = (url: string): Promise<string> =>
  new Promise((resolve, reject) => {
    http
      .get(url, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () => resolve(body));
      })
      .once("error", reject);
  });
