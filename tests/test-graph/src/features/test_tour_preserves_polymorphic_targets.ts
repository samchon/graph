import { TestValidator } from "@nestia/e2e";
import {
  ISamchonGraphDump,
  SamchonGraphApplication,
  SamchonGraphMemory,
} from "@samchon/graph";

/**
 * One interface call expression can have many possible runtime implementations.
 * The graph keeps every semantic target. Tour centrality and compact steps use
 * those same graph facts rather than collapsing targets by source location.
 */
export const test_tour_preserves_polymorphic_targets = async () => {
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
    "every polymorphic target contributes to the canonical reach score",
    output.result.entrypoints.map((node) => node.name),
    ["Context.Render"],
  );

  const dispatch = await new SamchonGraphApplication(graph).inspect_code_graph({
    question: "Trace response rendering through its polymorphic writer.",
    draft: {
      reason: "A tour is the smallest request for this polymorphic runtime flow.",
      type: "tour",
    },
    review: "Tour is appropriate for the polymorphic rendering flow.",
    request: {
      type: "tour",
      reinterpretations: ["Context.Render"],
      limit: 1,
      includeTests: false,
    },
  });
  if (dispatch.result.type !== "tour")
    throw new Error(`Expected a tour result, got ${dispatch.result.type}.`);
  TestValidator.equals(
    "the tour keeps every same-site target in its reached facts",
    dispatch.result.primaryFlow[0]?.reached.map((node) => node.name),
    [
      "Render.Write",
      ...Array.from({ length: 8 }, (_, index) => `write${index}`),
      "Render.Flush",
    ],
  );
  TestValidator.predicate(
    "polymorphic alternatives remain distinct compact story steps",
    dispatch.result.primaryFlow[0]?.steps.some((step) =>
      step.includes("Render.Flush"),
    ) === false,
  );
};

const dump = (): ISamchonGraphDump => {
  const nodes: ISamchonGraphDump["nodes"] = [
    owner("engine.go#Engine:class", "Engine", "engine.go"),
    member(
      "engine.go#Engine.Serve:method",
      "Serve",
      "Engine.Serve",
      "engine.go",
      "public",
    ),
    owner("context.go#Context:class", "Context", "context.go"),
    member(
      "context.go#Context.Render:method",
      "Render",
      "Context.Render",
      "context.go",
      "public",
    ),
    {
      ...owner("render/render.go#Render:interface", "Render", "render/render.go"),
      kind: "interface" as const,
    },
    member(
      "render/render.go#Render.Write:method",
      "Write",
      "Render.Write",
      "render/render.go",
      "public",
    ),
    member(
      "render/render.go#Render.Flush:method",
      "Flush",
      "Render.Flush",
      "render/render.go",
      "public",
    ),
    member(
      "engine.go#Engine.Broken:method",
      "Broken",
      "Engine.Broken",
      "engine.go",
      "public",
    ),
    member(
      "engine.go#Engine.Ghost:method",
      "Ghost",
      "Engine.Ghost",
      "engine.go",
      "public",
    ),
    callable("dispatch.go#match:function", "match", "dispatch.go"),
    callable("handlers.go#runHandlers:function", "runHandlers", "handlers.go"),
    callable("response.go#writeResponse:function", "writeResponse", "response.go"),
    ...Array.from({ length: 8 }, (_, index) =>
      callable(
        `render/format${index}.go#write${index}:function`,
        `write${index}`,
        `render/format${index}.go`,
      ),
    ),
  ];
  const dispatchEvidence = {
    startLine: 20,
    startCol: 3,
    endLine: 20,
    endCol: 14,
  };
  return {
    project: "/go",
    languages: ["go"],
    indexer: "lsp",
    nodes,
    edges: [
      { from: "engine.go", to: "engine.go#Engine:class", kind: "exports" },
      { from: "context.go", to: "context.go#Context:class", kind: "exports" },
      {
        from: "engine.go#Engine:class",
        to: "engine.go#Engine.Serve:method",
        kind: "contains",
      },
      {
        from: "context.go#Context:class",
        to: "context.go#Context.Render:method",
        kind: "contains",
      },
      {
        from: "render/render.go#Render:interface",
        to: "render/render.go#Render.Write:method",
        kind: "contains",
      },
      {
        from: "render/render.go#Render:interface",
        to: "render/render.go#Render.Flush:method",
        kind: "contains",
      },
      {
        from: "engine.go#Engine:class",
        to: "engine.go#Engine.Broken:method",
        kind: "contains",
      },
      {
        from: "engine.go#Engine:class",
        to: "engine.go#Engine.Ghost:method",
        kind: "contains",
      },
      call("engine.go#Engine.Serve:method", "dispatch.go#match:function", 5),
      call("dispatch.go#match:function", "handlers.go#runHandlers:function", 8),
      call(
        "handlers.go#runHandlers:function",
        "response.go#writeResponse:function",
        11,
      ),
      {
        from: "context.go#Context.Render:method",
        to: "render/render.go#Render.Write:method",
        kind: "calls",
        evidence: dispatchEvidence,
      },
      ...Array.from({ length: 8 }, (_, index) => ({
        from: "context.go#Context.Render:method",
        to: `render/format${index}.go#write${index}:function`,
        kind: "calls" as const,
        evidence: dispatchEvidence,
      })),
      {
        from: "context.go#Context.Render:method",
        to: "render/render.go#Render.Flush:method",
        kind: "calls",
        evidence: {
          startLine: 21,
          startCol: 3,
          endLine: 21,
          endCol: 14,
        },
      },
      {
        from: "engine.go#Engine.Broken:method",
        to: "missing.go#first:function",
        kind: "calls",
        evidence: { startLine: 30, startCol: 2 },
      },
      {
        from: "engine.go#Engine.Broken:method",
        to: "missing.go#second:function",
        kind: "calls",
        evidence: { startLine: 30, startCol: 2 },
      },
      {
        from: "engine.go#Engine.Ghost:method",
        to: "missing.go#single:function",
        kind: "calls",
        evidence: { startLine: 35, startCol: 2 },
      },
    ],
  };
};

const owner = (id: string, name: string, file: string) => ({
  id,
  kind: "class" as const,
  language: "go" as const,
  name,
  file,
  external: false,
  exported: true,
  evidence: { startLine: 1, endLine: 2 },
});

const member = (
  id: string,
  name: string,
  qualifiedName: string,
  file: string,
  visibility: "public" | "private",
) => ({
  id,
  kind: "method" as const,
  language: "go" as const,
  name,
  qualifiedName,
  file,
  external: false,
  modifiers: [visibility],
  evidence: { startLine: 3, endLine: 8 },
});

const callable = (id: string, name: string, file: string) => ({
  id,
  kind: "function" as const,
  language: "go" as const,
  name,
  file,
  external: false,
  evidence: { startLine: 1, endLine: 3 },
});

const call = (from: string, to: string, startLine: number) => ({
  from,
  to,
  kind: "calls" as const,
  evidence: { startLine },
});
