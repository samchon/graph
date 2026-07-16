import { TestValidator } from "@nestia/e2e";
import {
  ISamchonGraphDump,
  SamchonGraphApplication,
  SamchonGraphMemory,
} from "@samchon/graph";

export const test_tour_treats_vendored_deps_as_support_code = async () => {
  const product = "src/server.c#processCommand:function";
  const dispatch = "src/server.c#call:function";
  const vendored = "deps/xxhash/xxhash.h#XXH3_ACCUMULATE_TEMPLATE:function";
  const dump: ISamchonGraphDump = {
    project: "/redis",
    languages: ["c"],
    indexer: "static",
    nodes: [
      node(product, "processCommand", "src/server.c", true),
      node(dispatch, "call", "src/server.c"),
      node(vendored, "XXH3_ACCUMULATE_TEMPLATE", "deps/xxhash/xxhash.h", true),
      node("deps/xxhash/vector.c#load:function", "load", "deps/xxhash/vector.c"),
      node("deps/xxhash/multiply.c#multiply:function", "multiply", "deps/xxhash/multiply.c"),
      node("deps/xxhash/swap.c#swap:function", "swap", "deps/xxhash/swap.c"),
    ],
    edges: [
      { from: "src/server.c", to: product, kind: "exports" },
      { from: product, to: dispatch, kind: "calls", evidence: { startLine: 2 } },
      { from: "deps/xxhash/xxhash.h", to: vendored, kind: "exports" },
      {
        from: vendored,
        to: "deps/xxhash/vector.c#load:function",
        kind: "calls",
        evidence: { startLine: 2 },
      },
      {
        from: vendored,
        to: "deps/xxhash/multiply.c#multiply:function",
        kind: "calls",
        evidence: { startLine: 3 },
      },
      {
        from: vendored,
        to: "deps/xxhash/swap.c#swap:function",
        kind: "calls",
        evidence: { startLine: 4 },
      },
    ],
  };
  const output = await new SamchonGraphApplication(
    SamchonGraphMemory.from(dump),
  ).inspect_code_graph({
    question: "Show the central runtime flow.",
    draft: {
      reason: "A tour is the smallest request for the central runtime flow.",
      type: "tour",
    },
    review: "Tour is appropriate for ranking the central runtime flow.",
    request: { type: "tour", reinterpretations: [], limit: 1 },
  });
  if (output.result.type !== "tour")
    throw new Error(`Expected a tour result, got ${output.result.type}.`);

  TestValidator.equals(
    "a vendored deps subtree cannot become the product's central entrypoint",
    output.result.entrypoints.map((entry) => entry.name),
    ["processCommand"],
  );
};

const node = (
  id: string,
  name: string,
  file: string,
  exported = false,
): ISamchonGraphDump["nodes"][number] => ({
  id,
  kind: "function",
  language: "c",
  name,
  file,
  external: false,
  exported,
  evidence: { startLine: 1, endLine: 5 },
});
