import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { buildGraphDump } from "./indexer/buildGraphDump";
import { IGraphArguments, parseGraphArgs } from "./parseGraphArgs";
import { reduce, type RawDump } from "./reduce";

interface ViewOptions {
  graph: IGraphArguments;
  port: number;
  open: boolean;
  maxNodes: number;
}

function parseViewArgs(argv: readonly string[]): ViewOptions {
  const opts: ViewOptions = {
    graph: {},
    port: 0,
    open: true,
    maxNodes: 1200,
  };
  const graphArgs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--port") opts.port = Number(argv[++i]);
    else if (arg.startsWith("--port="))
      opts.port = Number(arg.slice("--port=".length));
    else if (arg === "--no-open") opts.open = false;
    else if (arg === "--max-nodes") opts.maxNodes = Number(argv[++i]);
    else if (arg.startsWith("--max-nodes="))
      opts.maxNodes = Number(arg.slice("--max-nodes=".length));
    else {
      graphArgs.push(arg);
      if (
        !arg.includes("=") &&
        [
          "--cwd",
          "--mode",
          "--language",
          "--server",
          "--server-arg",
          "--lsp-concurrency",
          "--lsp-ready-quiet-ms",
          "--graph-file",
        ].includes(arg)
      )
        graphArgs.push(argv[++i] ?? "");
    }
  }
  opts.graph = parseGraphArgs(graphArgs);
  return opts;
}

/**
 * `samchon-graph view`: build the project's code graph, reduce it, and serve a
 * self-contained 3D viewer on a localhost port, opening the browser. The
 * package indexer produces the graph (the same `dump` the docs document);
 * everything else is local and offline. The process stays alive serving until
 * Ctrl+C.
 */
export async function runView(argv: readonly string[]): Promise<number | void> {
  const opts = parseViewArgs(argv);
  const cwd = path.resolve(opts.graph.cwd ?? process.cwd());
  process.stderr.write(`@samchon/graph: building the graph for ${cwd}...\n`);
  let raw: RawDump;
  try {
    raw = opts.graph.graphFile
      ? (JSON.parse(fs.readFileSync(opts.graph.graphFile, "utf8")) as RawDump)
      : await buildGraphDump(opts.graph);
  } catch (err) {
    process.stderr.write(
      `@samchon/graph: could not build the graph: ${String(err)}\n`,
    );
    return 1;
  }

  const payload = reduce(raw, { maxNodes: opts.maxNodes });
  payload.project = path.basename(cwd);
  const graphJson = JSON.stringify(payload);

  const viewerDir = path.join(__dirname, "viewer");
  let indexHtml: Buffer;
  let viewerJs: Buffer;
  try {
    indexHtml = fs.readFileSync(path.join(viewerDir, "index.html"));
    viewerJs = fs.readFileSync(path.join(viewerDir, "viewer.js"));
  } catch (err) {
    process.stderr.write(
      `@samchon/graph: the bundled viewer is missing (${String(err)}). ` +
        "Reinstall @samchon/graph.\n",
    );
    return 1;
  }

  const server = http.createServer((req, res) => {
    const url = (req.url ?? "/").split("?")[0];
    if (url === "/graph.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(graphJson);
    } else if (url === "/viewer.js") {
      res.writeHead(200, {
        "content-type": "application/javascript; charset=utf-8",
      });
      res.end(viewerJs);
    } else {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(indexHtml);
    }
  });

  server.listen(opts.port, "127.0.0.1", () => {
    const address = server.address();
    const port =
      typeof address === "object" && address ? address.port : opts.port;
    const url = `http://127.0.0.1:${port}/`;
    const counts = payload.counts;
    process.stderr.write(
      `@samchon/graph: ${counts.nodes.toLocaleString()} nodes / ${counts.links.toLocaleString()} edges` +
        ` (from ${counts.rawNodes.toLocaleString()} / ${counts.rawEdges.toLocaleString()})\n`,
    );
    process.stderr.write(`@samchon/graph: serving the 3D viewer at ${url}\n`);
    process.stderr.write("@samchon/graph: press Ctrl+C to stop.\n");
    if (opts.open) openBrowser(url);
  });
  // No return: the listening server keeps the process alive until Ctrl+C.
}

/** Best-effort open the URL in the default browser; the URL is printed anyway. */
function openBrowser(url: string): void {
  try {
    if (process.platform === "win32")
      spawn("cmd", ["/c", "start", "", url], {
        stdio: "ignore",
        detached: true,
      }).unref();
    else if (process.platform === "darwin")
      spawn("open", [url], { stdio: "ignore", detached: true }).unref();
    else spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
  } catch {
    /* the URL is printed; opening is a convenience */
  }
}
