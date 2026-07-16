import { TestValidator } from "@nestia/e2e";
import {
  ISamchonGraphDump,
  SamchonGraphApplication,
  SamchonGraphMemory,
} from "@samchon/graph";

export const test_tour_flat_terms_rank_all_matching_symbols =
  async () => {
    const graph = SamchonGraphMemory.from(dump());
    const output = await new SamchonGraphApplication(graph).inspect_code_graph({
      question: "Show the central runtime flow.",
      draft: {
        reason: "A tour is the smallest request for the hinted runtime flow.",
        type: "tour",
      },
      review: "Tour is appropriate for ranking the owner method flow.",
      request: {
        type: "tour",
        reinterpretations: ["RouterGroup handlers"],
        limit: 1,
        includeTests: false,
      },
    });
    if (output.result.type !== "tour")
      throw new Error(`Expected a tour result, got ${output.result.type}.`);

    TestValidator.equals(
      "flat terms rank every matching symbol by the canonical score",
      output.result.entrypoints.map((node) => node.name),
      ["RouterGroup.createStaticHandler"],
    );
  };

const dump = (): ISamchonGraphDump => ({
  project: "/go",
  languages: ["go"],
  indexer: "lsp",
  nodes: [
    node("router.go#RouterGroup:class", "class", "RouterGroup", undefined, "router.go"),
    node(
      "router.go#RouterGroup.handle:method",
      "method",
      "handle",
      "RouterGroup.handle",
      "router.go",
    ),
    node(
      "router.go#RouterGroup.createStaticHandler:method",
      "method",
      "createStaticHandler",
      "RouterGroup.createStaticHandler",
      "router.go",
    ),
    node("route.go#routeCore:function", "function", "routeCore", undefined, "route.go"),
    node("static.go#staticCore:function", "function", "staticCore", undefined, "static.go"),
  ],
  edges: [
    { from: "router.go", to: "router.go#RouterGroup:class", kind: "exports" },
    {
      from: "router.go#RouterGroup:class",
      to: "router.go#RouterGroup.handle:method",
      kind: "contains",
    },
    {
      from: "router.go#RouterGroup:class",
      to: "router.go#RouterGroup.createStaticHandler:method",
      kind: "contains",
    },
    {
      from: "router.go#RouterGroup.handle:method",
      to: "route.go#routeCore:function",
      kind: "calls",
      evidence: { startLine: 2 },
    },
    {
      from: "router.go#RouterGroup.createStaticHandler:method",
      to: "static.go#staticCore:function",
      kind: "calls",
      evidence: { startLine: 5 },
    },
  ],
});

const node = (
  id: string,
  kind: "class" | "method" | "function",
  name: string,
  qualifiedName: string | undefined,
  file: string,
) => ({
  id,
  kind,
  language: "go" as const,
  name,
  ...(qualifiedName === undefined ? {} : { qualifiedName }),
  file,
  external: false,
  evidence: { startLine: 1, endLine: 3 },
});
