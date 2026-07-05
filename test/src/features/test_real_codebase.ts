const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { TestValidator } = require("@nestia/e2e");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const {
  StdioClientTransport,
} = require("@modelcontextprotocol/sdk/client/stdio.js");
const { GraphMemory, SamchonGraphApplication, buildGraphDump } =
  require("../../../lib");

exports.test_real_codebase_static_dump_indexes_source_not_build_output = async () => {
  const dump = await buildGraphDump({
    cwd: process.cwd(),
    mode: "static",
    languages: ["typescript"],
  });

  TestValidator.equals("real codebase static indexer", dump.indexer, "static");
  TestValidator.equals("real codebase language set", dump.languages, ["typescript"]);
  TestValidator.predicate(
    "real codebase indexes substantial source graph",
    dump.nodes.length > 100 && dump.edges.length > 100,
  );
  TestValidator.predicate(
    "real codebase does not index built lib output",
    dump.nodes.every((node) => !node.file.startsWith("lib/")),
  );
  for (const expected of [
    ["src/application.ts", "SamchonGraphApplication"],
    ["src/indexer/buildGraph.ts", "buildGraphDump"],
    ["src/indexer/lspIndexer.ts", "buildLspGraph"],
    ["src/model/GraphMemory.ts", "GraphMemory"],
    ["src/operations/runTrace.ts", "runTrace"],
  ]) {
    TestValidator.predicate(
      `real codebase indexes ${expected[1]}`,
      dump.nodes.some((node) => node.file === expected[0] && node.name === expected[1]),
    );
  }
};

exports.test_real_codebase_operations_answer_about_package_symbols = async () => {
  const graph = GraphMemory.from(
    await buildGraphDump({
      cwd: process.cwd(),
      mode: "static",
      languages: ["typescript"],
    }),
  );
  const app = new SamchonGraphApplication(graph);

  const lookup = (
    await app.inspect_code_graph({
      question: "Find SamchonGraphApplication",
      draft: { reason: "Named symbol lookup is smallest.", type: "lookup" },
      review: "Lookup is the right request.",
      request: { type: "lookup", query: "SamchonGraphApplication" },
    })
  ).result;
  TestValidator.predicate(
    "real codebase lookup finds SamchonGraphApplication",
    lookup.hits.some(
      (hit) =>
        hit.name === "SamchonGraphApplication" &&
        hit.file === "src/application.ts",
    ),
  );

  const details = (
    await app.inspect_code_graph({
      question: "Inspect GraphMemory",
      draft: { reason: "Selected symbol shape needs details.", type: "details" },
      review: "Details is the right request.",
      request: { type: "details", handles: ["GraphMemory"], neighbors: true },
    })
  ).result;
  TestValidator.predicate(
    "real codebase details lists GraphMemory members",
    details.nodes.some(
      (node) =>
        node.name === "GraphMemory" &&
        node.members?.some((member) => member.name === "GraphMemory.node"),
    ),
  );

  const trace = (
    await app.inspect_code_graph({
      question: "Trace buildGraphDump",
      draft: { reason: "Flow question needs trace.", type: "trace" },
      review: "Trace is the right request.",
      request: {
        type: "trace",
        from: "buildGraphDump",
        direction: "forward",
        focus: "all",
        maxDepth: 2,
        maxNodes: 12,
      },
    })
  ).result;
  TestValidator.predicate(
    "real codebase trace reaches graph builders or validators",
    trace.reached.some((node) =>
      ["buildLspGraph", "buildStaticGraph", "validateDump"].includes(node.name),
    ),
  );
};

exports.test_real_codebase_cli_and_mcp_run_against_repository_root = async () => {
  const output = execFileSync(
    process.execPath,
    [
      path.join(process.cwd(), "lib", "bin.js"),
      "dump",
      "--mode",
      "static",
      "--language",
      "typescript",
      "--cwd",
      process.cwd(),
    ],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  const dump = JSON.parse(output);
  TestValidator.predicate(
    "real codebase CLI dump has source nodes",
    dump.nodes.some(
      (node) => node.file === "src/application.ts" && node.name === "SamchonGraphApplication",
    ),
  );

  const client = new Client({ name: "samchon-real-codebase-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      path.join(process.cwd(), "lib", "bin.js"),
      "--mode",
      "static",
      "--language",
      "typescript",
      "--cwd",
      process.cwd(),
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
          hit.file === "src/indexer/buildGraph.ts",
      ),
    );
  } finally {
    await client.close();
  }
};
