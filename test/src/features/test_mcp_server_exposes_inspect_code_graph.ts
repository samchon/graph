import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { TestValidator } from "@nestia/e2e";

import { GraphFixtures } from "../internal/GraphFixtures";
import { GraphPaths } from "../internal/GraphPaths";

export const test_mcp_server_exposes_inspect_code_graph = async () => {
  const root = GraphFixtures.createOrderFixture();
  const client = new Client({ name: "samchon-graph-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [GraphPaths.graphBin, "--mode", "static", "--cwd", root],
    stderr: "pipe",
  });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    TestValidator.equals(
      "MCP exposes one graph tool",
      tools.tools.map((tool) => tool.name),
      ["inspect_code_graph"],
    );

    const result = await client.callTool({
      name: "inspect_code_graph",
      arguments: {
        question: "Show project overview",
        draft: { reason: "Overview is the smallest project map.", type: "overview" },
        review: "Overview is appropriate.",
        request: { type: "overview" },
      },
    });
    const text = result.content?.find((item) => item.type === "text")?.text;
    TestValidator.predicate("MCP call returns text content", typeof text === "string");
    const parsed = JSON.parse(text);
    TestValidator.equals("MCP call result type", parsed.result.type, "overview");
    TestValidator.predicate("MCP overview has nodes", parsed.result.counts.nodes > 0);
  } finally {
    await client.close();
  }
};
