import { TestValidator } from "@nestia/e2e";
import { buildLspGraph } from "@samchon/graph";
import fs from "node:fs";
import path from "node:path";

// `isBulkGraphSession` is internal to the package, so it is reached by path
// rather than through the public barrel.
import { isBulkGraphSession } from "../../../../packages/graph/src/provider/isBulkGraphSession";
import { GraphPaths } from "../internal/GraphPaths";

export const test_ttscgraph_bulk_session_stays_alive_when_kept = async () => {
  const root = GraphPaths.createTempDirectory("samchon-graph-ttscgraph-keepalive-");
  fs.mkdirSync(path.join(root, "src", "core"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { baseUrl: "." } }),
  );
  fs.writeFileSync(path.join(root, "src", "index.ts"), "export * from './core/order';\n");
  fs.writeFileSync(
    path.join(root, "src", "core", "order.ts"),
    "export async function first() {}\n",
  );
  fs.writeFileSync(path.join(root, "src", "empty.ts"), "export {};\n");

  // A one-shot `dump` closes the ttscgraph provider the moment its snapshot is
  // collected. A resident MCP server passes `keepAlive`, and the successful
  // bulk provider must then be retained in the session map so a later refresh
  // reuses the same warm compiler process instead of paying a full reindex
  // again. The marker proves the retained session is the one this build owns.
  const marker = path.join(root, "closed.txt");
  const result = await buildLspGraph(
    {
      cwd: root,
      languages: ["typescript"],
      keepAlive: true,
    },
    {
      resolveTtscGraphCommand: () => ({
        command: process.execPath,
        args: [GraphPaths.fakeTtscGraphServer, `--marker=${marker}`],
      }),
    },
  );

  TestValidator.equals(
    "a kept-alive strict build is still a pure LSP index",
    result.dump.indexer,
    "lsp",
  );
  const session = result.sessions?.get("typescript");
  TestValidator.predicate(
    "keepAlive retains the successful ttscgraph bulk session",
    session !== undefined && isBulkGraphSession(session),
  );
  TestValidator.predicate(
    "the retained bulk session was not closed while the graph was built",
    !fs.existsSync(marker),
  );

  // The retained session is the caller's to dispose; closing it shuts the
  // process down (`"close" in session` narrows the live-session union to the
  // bulk provider, which the assertion above already proved this is).
  if (session !== undefined && "close" in session) await session.close();
  TestValidator.equals(
    "closing does not trust the owned process to acknowledge termination",
    fs.existsSync(marker),
    false,
  );
};
