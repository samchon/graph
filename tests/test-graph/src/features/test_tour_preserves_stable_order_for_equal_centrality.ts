import { TestValidator } from "@nestia/e2e";
import {
  ISamchonGraphDump,
  SamchonGraphApplication,
  SamchonGraphMemory,
} from "@samchon/graph";

/** Equal scores retain the graph's deterministic node order. */
export const test_tour_preserves_stable_order_for_equal_centrality =
  async () => {
    const graph = SamchonGraphMemory.from(dump());
    const output = await new SamchonGraphApplication(graph).inspect_code_graph({
      question: "Show the central runtime flow.",
      draft: {
        reason: "A tour is the smallest request for the central runtime flow.",
        type: "tour",
      },
      review: "Tour is appropriate for ranking the central runtime flow.",
      request: {
        type: "tour",
        reinterpretations: [],
        limit: 1,
        includeTests: false,
      },
    });
    if (output.result.type !== "tour")
      throw new Error(`Expected a tour result, got ${output.result.type}.`);

    TestValidator.equals(
      "equal structural ranks retain node order without another tie-break",
      output.result.entrypoints.map((node) => node.name),
      ["Engine.Wrapper"],
    );

    const prose = await new SamchonGraphApplication(
      graph,
    ).inspect_code_graph({
      question: "Show the central runtime flow.",
      draft: {
        reason: "A tour is the smallest request for the hinted runtime flow.",
        type: "tour",
      },
      review: "Tour is appropriate for ranking the hinted runtime flow.",
      request: {
        type: "tour",
        reinterpretations: ["public surface", "runtime lifecycle"],
        limit: 1,
        includeTests: false,
      },
    });
    if (prose.result.type !== "tour")
      throw new Error(`Expected a tour result, got ${prose.result.type}.`);
    TestValidator.equals(
      "irrelevant prose preserves the same stable structural order",
      prose.result.entrypoints.map((node) => node.name),
      ["Engine.Wrapper"],
    );
  };

const dump = (): ISamchonGraphDump => ({
  project: "/go",
  languages: ["go"],
  indexer: "lsp",
  nodes: [
    {
      id: "engine.go#Engine:class",
      kind: "class",
      language: "go",
      name: "Engine",
      file: "engine.go",
      external: false,
      exported: true,
      evidence: { startLine: 1, endLine: 2 },
    },
    method("Wrapper", 3),
    method("Core", 10),
    worker("wrapper-a.go", "wrapperA"),
    worker("wrapper-b.go", "wrapperB"),
    worker("core-a.go", "coreA"),
    worker("core-b.go", "coreB"),
    worker("caller-a.go", "callerA"),
    worker("caller-b.go", "callerB"),
  ],
  edges: [
    { from: "engine.go", to: "engine.go#Engine:class", kind: "exports" },
    contain("Wrapper"),
    contain("Core"),
    call("engine.go#Engine.Wrapper:method", "wrapper-a.go#wrapperA:function", 4),
    call("wrapper-a.go#wrapperA:function", "wrapper-b.go#wrapperB:function", 1),
    call("engine.go#Engine.Core:method", "core-a.go#coreA:function", 11),
    call("core-a.go#coreA:function", "core-b.go#coreB:function", 1),
    call("caller-a.go#callerA:function", "engine.go#Engine.Core:method", 1),
    call("caller-b.go#callerB:function", "engine.go#Engine.Core:method", 1),
  ],
});

const method = (name: string, startLine: number) => ({
  id: `engine.go#Engine.${name}:method`,
  kind: "method" as const,
  language: "go" as const,
  name,
  qualifiedName: `Engine.${name}`,
  file: "engine.go",
  external: false,
  modifiers: ["public" as const],
  evidence: { startLine, endLine: startLine + 3 },
});

const worker = (file: string, name: string) => ({
  id: `${file}#${name}:function`,
  kind: "function" as const,
  language: "go" as const,
  name,
  file,
  external: false,
  evidence: { startLine: 1, endLine: 2 },
});

const contain = (name: string) => ({
  from: "engine.go#Engine:class",
  to: `engine.go#Engine.${name}:method`,
  kind: "contains" as const,
});

const call = (from: string, to: string, startLine: number) => ({
  from,
  to,
  kind: "calls" as const,
  evidence: { startLine },
});
