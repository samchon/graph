import { TestValidator } from "@nestia/e2e";
import {
  SamchonGraphApplication,
  SamchonGraphMemory,
} from "@samchon/graph";
import type {
  ISamchonGraphDump,
  ISamchonGraphTrace,
} from "@samchon/graph";

/**
 * A source file can execute code or import a dependency without declaring a
 * symbol of its own. The dump represents that module scope by the file id, so
 * the resident graph must give every such edge a real source endpoint.
 */
export const test_file_scope_edges_keep_their_source_endpoint = async () => {
  const startId = "src/server.ts#start:function";
  const dependencyId = "external:typescript:framework";
  const dump: ISamchonGraphDump = {
    project: "/bootstrap",
    languages: ["typescript"],
    indexer: "static",
    nodes: [
      {
        id: startId,
        kind: "function",
        language: "typescript",
        name: "start",
        file: "src/server.ts",
        external: false,
        exported: true,
        evidence: { startLine: 1, endLine: 1 },
      },
      {
        id: dependencyId,
        kind: "external_symbol",
        language: "typescript",
        name: "boot",
        file: "",
        external: true,
      },
    ],
    edges: [
      {
        from: "src/bootstrap.ts",
        to: startId,
        kind: "calls",
        evidence: { startLine: 1, endLine: 1 },
      },
      {
        from: "src/import-only.ts",
        to: dependencyId,
        kind: "imports",
        evidence: { startLine: 1, endLine: 1 },
      },
    ],
  };
  const graph = SamchonGraphMemory.from(dump);

  TestValidator.equals(
    "a declaration-free bootstrap file is a graph endpoint",
    graph.node("src/bootstrap.ts")?.kind,
    "file",
  );
  TestValidator.equals(
    "an import-only source file is a graph endpoint",
    graph.node("src/import-only.ts")?.kind,
    "file",
  );
  TestValidator.predicate(
    "every synthesized edge source resolves in resident memory",
    graph.edges.every((edge) => graph.node(edge.from) !== undefined),
  );

  const app = new SamchonGraphApplication(graph);
  const output = await app.inspect_code_graph({
    question: "What does the bootstrap file start?",
    draft: { reason: "The file endpoint is known.", type: "trace" },
    review: "A forward execution trace answers it.",
    request: {
      type: "trace",
      from: "src/bootstrap.ts",
      focus: "execution",
    },
  });
  const trace = output.result as ISamchonGraphTrace;
  TestValidator.equals(
    "trace preserves the synthesized file as its start endpoint",
    trace.start?.id,
    "src/bootstrap.ts",
  );
  TestValidator.predicate(
    "trace follows module-scope execution into the declared symbol",
    trace.reached.some((node) => node.id === startId),
  );
};
