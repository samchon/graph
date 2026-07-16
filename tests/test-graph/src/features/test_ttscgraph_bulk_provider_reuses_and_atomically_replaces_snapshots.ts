import { TestValidator } from "@nestia/e2e";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { SamchonGraphMemory } from "../../../../packages/graph/src/SamchonGraphMemory";
import { buildLspGraph } from "../../../../packages/graph/src/indexer/buildLspGraph";
import { TtscGraphClient } from "../../../../packages/graph/src/provider/ttscgraph/TtscGraphClient";
import { resolveTtscGraphCommand } from "../../../../packages/graph/src/provider/ttscgraph/resolveTtscGraphCommand";
import { ISamchonGraphDump } from "../../../../packages/graph/src/structures";
import { GraphPaths } from "../internal/GraphPaths";

export const test_ttscgraph_bulk_provider_reuses_and_atomically_replaces_snapshots =
  async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "samchon-graph-ttscgraph-provider-"),
    );
    fs.mkdirSync(path.join(root, "src", "core"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@core/*": ["src/core/*"] },
        },
      }),
    );
    fs.writeFileSync(
      path.join(root, "src", "index.ts"),
      "export * from '@core/order';\n",
    );
    fs.writeFileSync(
      path.join(root, "src", "core", "order.ts"),
      "export async function first() {}\n",
    );
    fs.writeFileSync(path.join(root, "src", "empty.ts"), "export {};\n");
    assertResolverPrecedence(root);
    const marker = path.join(root, "closed.txt");
    const client = new TtscGraphClient({
      root,
      command: process.execPath,
      args: [GraphPaths.fakeTtscGraphServer, `--marker=${marker}`],
    });

    const initial = await client.refresh();
    TestValidator.equals("the first full dump starts generation one", initial.generation, 1);
    TestValidator.equals("the compiler language is added losslessly", initial.snapshot.nodes[0]?.language, "typescript");
    TestValidator.equals("the module export surface folds onto its file", initial.snapshot.edges[0]?.from, "src/index.ts");
    TestValidator.equals("edge evidence keeps the module source file", initial.snapshot.edges[0]?.evidence?.file, "src/index.ts");
    TestValidator.predicate(
      "a declaration-free strict module keeps its canonical file manifest",
      initial.snapshot.nodes.some(
        (node) => node.id === "src/empty.ts" && node.kind === "file",
      ),
    );
    TestValidator.predicate(
      "a canonical bundled standard-library dependency remains an external fact",
      initial.snapshot.nodes.some(
        (node) =>
          node.id ===
            "bundled:///libs/lib.es2015.collection.d.ts#Map:interface" &&
          node.external &&
          node.evidence?.file ===
            "bundled:///libs/lib.es2015.collection.d.ts",
      ),
    );
    TestValidator.predicate(
      "a compiler-resolved paths-alias barrel keeps its cross-file export edge",
      initial.snapshot.edges.some(
        (edge) =>
          edge.kind === "exports" &&
          edge.from === "src/index.ts" &&
          edge.to === "src/core/order.ts#first:function",
      ),
    );
    TestValidator.predicate(
      "compiler flags and decorator literals survive adaptation",
      initial.snapshot.nodes[0]?.ignored === true &&
        initial.snapshot.nodes[0]?.closure === true &&
        initial.snapshot.nodes[0]?.decorators?.[0]?.arguments[0]?.literal === 1,
    );
    TestValidator.equals(
      "the snapshot exposes its observed source text",
      initial.snapshot.sources.get(path.join(root, "src", "core", "order.ts")),
      "export async function first() {}\n",
    );

    const unchanged = await client.refresh();
    TestValidator.predicate(
      "unchanged reuses the identical snapshot object",
      !unchanged.changed && unchanged.snapshot === initial.snapshot,
    );
    TestValidator.equals("unchanged keeps the generation", unchanged.generation, 1);

    const changed = await client.refresh();
    TestValidator.predicate(
      "a validated full dump atomically replaces the snapshot",
      changed.changed &&
        changed.generation === 2 &&
        changed.snapshot !== initial.snapshot &&
        changed.snapshot.nodes[0]?.name === "second",
    );
    await rejects(client.refresh(), "serve errors are surfaced");
    TestValidator.predicate(
      "a failed response cannot replace the last valid snapshot",
      client.current === changed.snapshot && client.generation === 2,
    );
    await client.close();
    TestValidator.equals(
      "close reaches only the provider process owned by the client",
      fs.readFileSync(marker, "utf8"),
      "closed\n",
    );

    const integrated = await buildLspGraph(
      {
        cwd: root,
        languages: ["typescript"],
      },
      {
        resolveTtscGraphCommand: () => ({
          command: process.execPath,
          args: [GraphPaths.fakeTtscGraphServer],
        }),
      },
    );
    TestValidator.equals(
      "a pure strict build reports its language",
      integrated.dump.languages,
      ["typescript"],
    );
    TestValidator.equals(
      "a pure strict build remains an LSP index",
      integrated.dump.indexer,
      "lsp",
    );
    TestValidator.predicate(
      "buildLspGraph preserves the compiler-resolved paths-alias export edge",
      integrated.dump.edges.some(
        (edge) =>
          edge.kind === "exports" &&
          edge.from === "src/index.ts" &&
          edge.to === "src/core/order.ts#first:function",
      ),
    );
    const memory = SamchonGraphMemory.from(integrated.dump);
    for (const file of [
      "src/index.ts",
      "src/core/order.ts",
      "src/empty.ts",
    ]) {
      TestValidator.equals(
        `strict module file ${file} appears exactly once in final memory`,
        memory.nodes.filter(
          (node) => node.id === file && node.kind === "file",
        ).length,
        1,
      );
    }
    TestValidator.predicate(
      "the empty strict module has the canonical file-node shape",
      memory.node("src/empty.ts")?.language === "typescript" &&
        memory.node("src/empty.ts")?.name === "empty.ts" &&
        memory.node("src/empty.ts")?.external === false,
    );
    TestValidator.equals(
      "an edge-and-declaration-free module invents no structural edge",
      memory.outgoing("src/empty.ts").length,
      0,
    );
    TestValidator.equals(
      "a strict module with a declaration contains it exactly once",
      memory
        .outgoing("src/core/order.ts")
        .filter((edge) => edge.kind === "contains")
        .map((edge) => edge.to),
      ["src/core/order.ts#first:function"],
    );

    const genericModuleId = "src/namespace.ts#Namespace:module";
    const genericMemory = SamchonGraphMemory.from({
      project: root,
      languages: ["typescript"],
      indexer: "lsp",
      nodes: [
        {
          id: genericModuleId,
          kind: "module",
          language: "typescript",
          name: "Namespace",
          file: "src/namespace.ts",
          external: false,
        },
      ],
      edges: [],
    } satisfies ISamchonGraphDump);
    TestValidator.predicate(
      "generic TypeScript module declarations remain symbols",
      genericMemory.node(genericModuleId)?.kind === "module" &&
        genericMemory
          .outgoing("src/namespace.ts")
          .some(
            (edge) => edge.kind === "contains" && edge.to === genericModuleId,
          ),
    );

    await assertInvalid(root, "--invalid", "a dangling compiler endpoint");
    await assertInvalid(root, "--invalid-span", "a reversed evidence span");
    await assertInvalid(root, "--invalid-path", "an escaping evidence path");
    await assertInvalid(
      root,
      "--invalid-node-evidence",
      "node evidence owned by another file",
    );
    await assertInvalid(
      root,
      "--invalid-edge-evidence",
      "edge evidence owned by another source file",
    );
    await assertInvalid(
      root,
      "--invalid-bundled-workspace",
      "a workspace node using an external bundled URI",
    );
  };

function assertResolverPrecedence(root: string): void {
  const resolverRoot = path.join(root, "resolver-project");
  const packageRoot = path.join(resolverRoot, "node_modules");
  const platformPackage = path.join(
    packageRoot,
    "@ttsc",
    `${process.platform}-${process.arch}`,
  );
  const executable = process.platform === "win32" ? "ttscgraph.exe" : "ttscgraph";
  const projectBinary = path.join(platformPackage, "bin", executable);
  fs.mkdirSync(path.join(packageRoot, "ttsc"), { recursive: true });
  fs.writeFileSync(
    path.join(packageRoot, "ttsc", "package.json"),
    JSON.stringify({ name: "ttsc", version: "0.19.0" }),
  );
  fs.mkdirSync(platformPackage, { recursive: true });
  fs.writeFileSync(
    path.join(platformPackage, "package.json"),
    JSON.stringify({
      name: `@ttsc/${process.platform}-${process.arch}`,
      version: "0.19.0",
    }),
  );
  writeExecutable(projectBinary);

  const globalBin = path.join(root, "stale-global-bin");
  const staleBinary = path.join(globalBin, executable);
  writeExecutable(staleBinary);
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: globalBin };
  delete env.TTSC_GRAPH_BINARY;
  TestValidator.equals(
    "the target project's platform binary precedes a stale global PATH binary",
    resolveTtscGraphCommand(resolverRoot, env)?.command,
    projectBinary,
  );

  const overrideBinary = path.join(root, "override", executable);
  writeExecutable(overrideBinary);
  env.TTSC_GRAPH_BINARY = overrideBinary;
  TestValidator.equals(
    "an absolute executable override has highest precedence",
    resolveTtscGraphCommand(resolverRoot, env)?.command,
    overrideBinary,
  );
  env.TTSC_GRAPH_BINARY = path.join(root, "missing", executable);
  TestValidator.equals(
    "a missing override cannot hide the target project's compatible binary",
    resolveTtscGraphCommand(resolverRoot, env)?.command,
    projectBinary,
  );
}

function writeExecutable(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "");
  if (process.platform !== "win32") fs.chmodSync(file, 0o755);
}

async function assertInvalid(
  root: string,
  mode: string,
  description: string,
): Promise<void> {
  const invalid = new TtscGraphClient({
    root,
    command: process.execPath,
    args: [GraphPaths.fakeTtscGraphServer, mode],
  });
  try {
    await rejects(
      invalid.refresh(),
      `${description} fails closed`,
    );
    TestValidator.predicate(
      "an invalid full dump publishes no partial state",
      invalid.current === undefined && invalid.generation === 0,
    );
  } finally {
    await invalid.close();
  }
}

async function rejects(task: Promise<unknown>, label: string): Promise<void> {
  let error: unknown;
  try {
    await task;
  } catch (caught) {
    error = caught;
  }
  TestValidator.predicate(label, error instanceof Error);
}
