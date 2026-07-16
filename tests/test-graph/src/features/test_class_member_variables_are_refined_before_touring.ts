import { TestValidator } from "@nestia/e2e";
import {
  SamchonGraphApplication,
  SamchonGraphMemory,
} from "@samchon/graph";
import type { ISamchonGraphDump } from "@samchon/graph";

/**
 * The LSP ingest boundary normalizes class fields and arrow-function members
 * before their ids and edges are formed. Resident memory therefore receives a
 * coherent dump and only decides which properties have executable evidence.
 */
export const test_class_member_variables_are_refined_before_touring = async () => {
  const classId = "src/App.ts#App:class";
  const dataId = "src/App.ts#App.state:property";
  const callbackId = "src/App.ts#App.render:property";
  const helperId = "src/App.ts#draw:function";
  const topLevelId = "src/App.ts#version:variable";
  const dump: ISamchonGraphDump = {
    project: "/app",
    languages: ["typescript"],
    indexer: "lsp",
    nodes: [
      node(classId, "class", "App", "App", 1, true),
      node(dataId, "property", "state", "App.state", 2),
      node(callbackId, "property", "render", "App.render", 3),
      node(helperId, "function", "draw", undefined, 4),
      node(topLevelId, "variable", "version", undefined, 5),
    ],
    edges: [{ from: callbackId, to: helperId, kind: "calls" }],
  };

  const graph = SamchonGraphMemory.from(dump);
  TestValidator.equals(
    "a data field reaches memory with its owned declaration kind",
    graph.node(dataId)?.kind,
    "property",
  );
  TestValidator.equals(
    "an executable arrow property reaches memory with the same owned kind",
    graph.node(callbackId)?.kind,
    "property",
  );
  TestValidator.equals(
    "a top-level variable remains a variable",
    graph.node(topLevelId)?.kind,
    "variable",
  );
  TestValidator.equals(
    "resident loading does not mutate the caller's coherent dump",
    dump.nodes.find((candidate) => candidate.id === dataId)?.kind,
    "property",
  );

  const output = await new SamchonGraphApplication(graph).inspect_code_graph({
    question: "How does the App render the scene?",
    draft: { reason: "This asks for a broad runtime path.", type: "tour" },
    review: "A tour should rank executable entrypoints only.",
    request: { type: "tour", reinterpretations: [] },
  });
  if (output.result.type !== "tour") {
    throw new Error("expected a tour result");
  }
  TestValidator.predicate(
    "a data-only property cannot pollute the executable tour surface",
    !output.result.entrypoints.some((entry) => entry.id === dataId),
  );
  TestValidator.predicate(
    "an owned property with execution evidence remains tourable",
    output.result.entrypoints.some((entry) => entry.id === callbackId),
  );
};

const node = (
  id: string,
  kind: "class" | "function" | "property" | "variable",
  name: string,
  qualifiedName: string | undefined,
  line: number,
  exported = false,
) => ({
  id,
  kind,
  language: "typescript" as const,
  name,
  ...(qualifiedName === undefined ? {} : { qualifiedName }),
  file: "src/App.ts",
  external: false,
  exported,
  evidence: { startLine: line, endLine: line },
});
