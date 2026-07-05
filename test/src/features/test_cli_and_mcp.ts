const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { TestValidator } = require("@nestia/e2e");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const {
  StdioClientTransport,
} = require("@modelcontextprotocol/sdk/client/stdio.js");
const { createOrderFixture } = require("../internal/fixtures.ts");

exports.test_cli_dump_prints_graph_json = () => {
  const root = createOrderFixture();
  const output = execFileSync(
    process.execPath,
    [
      path.join(process.cwd(), "lib", "bin.js"),
      "dump",
      "--mode",
      "static",
      "--cwd",
      root,
    ],
    { encoding: "utf8" },
  );
  const dump = JSON.parse(output);
  TestValidator.equals("CLI dump indexer", dump.indexer, "static");
  TestValidator.predicate("CLI dump has nodes", dump.nodes.length > 0);
};

exports.test_mcp_server_exposes_inspect_code_graph = async () => {
  const root = createOrderFixture();
  const client = new Client({ name: "samchon-graph-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      path.join(process.cwd(), "lib", "bin.js"),
      "--mode",
      "static",
      "--cwd",
      root,
    ],
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
