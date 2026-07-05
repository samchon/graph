const { execFileSync, spawnSync } = require("node:child_process");
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

exports.test_cli_help_prints_usage = () => {
  const result = spawnSync(
    process.execPath,
    [path.join(process.cwd(), "lib", "bin.js"), "--help"],
    { encoding: "utf8" },
  );

  TestValidator.equals("CLI help exit code", result.status, 0);
  TestValidator.predicate(
    "CLI help prints usage",
    result.stdout.includes("Usage:") && result.stdout.includes("samchon-graph dump"),
  );
  TestValidator.equals("CLI help has no stderr", result.stderr, "");
};

exports.test_cli_rejects_invalid_server_arguments_without_stack_trace = () => {
  const result = spawnSync(
    process.execPath,
    [path.join(process.cwd(), "lib", "bin.js"), "--mode", "invalid"],
    { encoding: "utf8" },
  );

  TestValidator.equals("invalid CLI exits with failure", result.status, 1);
  TestValidator.predicate(
    "invalid CLI prints package error",
    result.stderr.includes("@samchon/graph: Invalid --mode: invalid"),
  );
  TestValidator.predicate(
    "invalid CLI does not leak stack trace",
    !result.stderr.includes("\n    at "),
  );
};

exports.test_cli_rejects_missing_option_values = () => {
  const result = spawnSync(
    process.execPath,
    [path.join(process.cwd(), "lib", "bin.js"), "dump", "--cwd"],
    { encoding: "utf8" },
  );

  TestValidator.equals("missing option exits with failure", result.status, 1);
  TestValidator.predicate(
    "missing option prints package error",
    result.stderr.includes("@samchon/graph: Missing value for --cwd"),
  );
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
