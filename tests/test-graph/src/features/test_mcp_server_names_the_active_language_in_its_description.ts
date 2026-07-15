import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { TestValidator } from "@nestia/e2e";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { GraphFixtures } from "../internal/GraphFixtures";
import { GraphPaths } from "../internal/GraphPaths";

// The interface-level JSDoc ("## What This MCP Is" ...) is transmitted as the
// MCP session's `instructions`, separate from each tool's own `description`
// (the method-level JSDoc) — both carry the `__LANG__` placeholder and both
// need checking.
const sessionOf = async (
  args: string[],
  cwd?: string,
): Promise<{ description: string; instructions: string }> => {
  const client = new Client({ name: "samchon-graph-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [GraphPaths.graphBin, ...args],
    stderr: "pipe",
    ...(cwd !== undefined ? { cwd } : {}),
  });
  await client.connect(transport);
  try {
    // Coverage instrumentation adds real overhead to every spawned child
    // process; the SDK's 60s default has been observed to trip under a
    // fully-instrumented suite run even though the call itself is fast.
    const tools = await client.listTools(undefined, { timeout: 120_000 });
    return {
      description: tools.tools[0]?.description ?? "",
      instructions: client.getInstructions() ?? "",
    };
  } finally {
    await client.close();
  }
};

export const test_mcp_server_names_the_active_language_in_its_description = async () => {
  // The fixture mixes TypeScript and Go source, so `--language typescript`
  // pins the session to a single language while the unfiltered scan below
  // naturally discovers both.
  const root = GraphFixtures.createOrderFixture();

  const ts = await sessionOf(["--mode", "static", "--cwd", root, "--language", "typescript"]);
  TestValidator.predicate(
    "a single-language session names that language in the tool description",
    ts.description.includes("Answer a TypeScript question"),
  );
  TestValidator.predicate(
    "a single-language session names that language in the session instructions",
    ts.instructions.includes("index-built TypeScript graph contract"),
  );
  // §4a: Codex weighs the first 512 characters of the server instructions, so
  // they open with what the tool is and what it answers, before any contract
  // language. §4c: typia caps the tool description at 1,024 characters and
  // rejects the build past it, so the request menu is the only thing competing
  // for that budget.
  TestValidator.predicate(
    "the instructions say what the tool is inside the first 512 characters",
    ts.instructions.slice(0, 512).includes("inspect_code_graph"),
  );
  TestValidator.predicate(
    "the tool description fits the schema budget",
    ts.description.length <= 1_024,
  );

  const mixed = await sessionOf(["--mode", "static", "--cwd", root]);
  TestValidator.predicate(
    "a multi-language session falls back to the generic name in the tool description",
    mixed.description.includes("Answer a code question"),
  );
  TestValidator.predicate(
    "a multi-language session falls back to the generic name in the session instructions",
    mixed.instructions.includes("index-built code graph contract"),
  );

  // A pre-built dump (`--graph-file`) resolves the language from the dump
  // itself rather than re-scanning the filesystem.
  const dump = execFileSync(
    process.execPath,
    [GraphPaths.graphBin, "dump", "--mode", "static", "--cwd", root, "--language", "typescript"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const graphFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-dump-lang-")),
    "graph.json",
  );
  fs.writeFileSync(graphFile, dump);
  const served = await sessionOf(["--graph-file", graphFile]);
  TestValidator.predicate(
    "a graph-file session names the language recorded in the dump",
    served.description.includes("Answer a TypeScript question"),
  );

  // Without `--cwd`, the resident source falls back to the server process's
  // own working directory.
  const implicitCwd = await sessionOf(["--mode", "static", "--language", "typescript"], root);
  TestValidator.predicate(
    "an implicit cwd still resolves the active language",
    implicitCwd.description.includes("Answer a TypeScript question"),
  );

  // Exercise startServer's `once` memoizer on the `--graph-file` source: call the
  // tool twice so both the first (uncached) and second (cached) source reads run.
  const callClient = new Client({ name: "samchon-graph-call", version: "1.0.0" });
  const callTransport = new StdioClientTransport({
    command: process.execPath,
    args: [GraphPaths.graphBin, "--graph-file", graphFile],
    stderr: "pipe",
  });
  await callClient.connect(callTransport);
  try {
    for (let index = 0; index < 2; index++) {
      const result = await callClient.callTool(
        {
          name: "inspect_code_graph",
          arguments: {
            question: "broad orientation",
            draft: { reason: "overview is the smallest broad step", type: "overview" },
            review: "overview is sufficient",
            request: { type: "overview" },
          },
        },
        undefined,
        { timeout: 120_000 },
      );
      // The result ships once now (§4j): `structuredContent` and no text copy.
      TestValidator.predicate(
        "a graph-file session answers from the memoized graph",
        (result.structuredContent as { result?: { type?: string } } | undefined)
          ?.result?.type === "overview",
      );
    }
  } finally {
    await callClient.close();
  }
};
