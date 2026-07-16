import { TestValidator } from "@nestia/e2e";
import {
  ISamchonGraphDump,
  SamchonGraphApplication,
  SamchonGraphMemory,
} from "@samchon/graph";

/** Tour publication follows containment, independent of language visibility. */
export const test_tour_go_receivers_inherit_owner_export_surface = async () => {
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
    "a receiver method inherits its exported owner's surface",
    output.result.entrypoints.map((node) => node.name),
    ["Engine.handleEverything"],
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
    method("ServeHTTP", "public", 3),
    method("handleEverything", "private", 10),
    ...Array.from({ length: 3 }, (_, index) =>
      worker("public", index),
    ),
    ...Array.from({ length: 9 }, (_, index) =>
      worker("private", index),
    ),
  ],
  edges: [
    { from: "engine.go", to: "engine.go#Engine:class", kind: "exports" },
    {
      from: "engine.go#Engine:class",
      to: "engine.go#Engine.ServeHTTP:method",
      kind: "contains",
    },
    {
      from: "engine.go#Engine:class",
      to: "engine.go#Engine.handleEverything:method",
      kind: "contains",
    },
    ...Array.from({ length: 3 }, (_, index) => ({
      from: "engine.go#Engine.ServeHTTP:method",
      to: `public/step${index}.go#work${index}:function`,
      kind: "calls" as const,
      evidence: { startLine: 4 + index },
    })),
    ...Array.from({ length: 9 }, (_, index) => ({
      from: "engine.go#Engine.handleEverything:method",
      to: `private/step${index}.go#work${index}:function`,
      kind: "calls" as const,
      evidence: { startLine: 11 + index },
    })),
  ],
});

const method = (
  name: string,
  visibility: "public" | "private",
  startLine: number,
) => ({
  id: `engine.go#Engine.${name}:method`,
  kind: "method" as const,
  language: "go" as const,
  name,
  qualifiedName: `Engine.${name}`,
  file: "engine.go",
  external: false,
  modifiers: [visibility],
  evidence: { startLine, endLine: startLine + 4 },
});

const worker = (scope: "public" | "private", index: number) => ({
  id: `${scope}/step${index}.go#work${index}:function`,
  kind: "function" as const,
  language: "go" as const,
  name: `work${index}`,
  file: `${scope}/step${index}.go`,
  external: false,
  evidence: { startLine: 1, endLine: 2 },
});
