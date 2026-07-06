import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { TestValidator } from "@nestia/e2e";
import { execFileSync } from "node:child_process";

import { GraphPaths } from "../internal/GraphPaths";

export const test_real_codebase_cli_and_mcp_run_against_repository_root = async () => {
  const output = execFileSync(
    process.execPath,
    [
      GraphPaths.graphBin,
      "dump",
      "--mode",
      "static",
      "--language",
      "typescript",
      "--cwd",
      GraphPaths.graphPackageRoot,
    ],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  const dump = JSON.parse(output);
  TestValidator.predicate(
    "real codebase CLI dump has source nodes",
    dump.nodes.some(
      (node) =>
        node.file === "src/SamchonGraphApplication.ts" &&
        node.name === "SamchonGraphApplication",
    ),
  );

  const client = new Client({ name: "samchon-real-codebase-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      GraphPaths.graphBin,
      "--mode",
      "static",
      "--language",
      "typescript",
      "--cwd",
      GraphPaths.graphPackageRoot,
    ],
    stderr: "pipe",
  });
  await client.connect(transport);
  try {
    const result = await client.callTool({
      name: "inspect_code_graph",
      arguments: {
        question: "Find buildGraphDump in this package",
        draft: { reason: "Named package symbol lookup.", type: "lookup" },
        review: "Lookup is sufficient for the real-codebase e2e.",
        request: { type: "lookup", query: "buildGraphDump" },
      },
    });
    const text = result.content?.find((item) => item.type === "text")?.text;
    TestValidator.predicate("real codebase MCP returns text", typeof text === "string");
    const parsed = JSON.parse(text);
    TestValidator.predicate(
      "real codebase MCP lookup returns buildGraphDump",
      parsed.result.hits.some(
        (hit) =>
          hit.name === "buildGraphDump" &&
          hit.file === "src/indexer/buildGraphDump.ts",
      ),
    );
  } finally {
    await client.close();
  }
};
