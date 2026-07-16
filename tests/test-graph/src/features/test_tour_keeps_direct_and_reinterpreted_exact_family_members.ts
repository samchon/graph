import { TestValidator } from "@nestia/e2e";
import {
  ISamchonGraphDump,
  SamchonGraphApplication,
  SamchonGraphMemory,
} from "@samchon/graph";

export const test_tour_keeps_direct_and_reinterpreted_exact_family_members = async () => {
  const dump: ISamchonGraphDump = {
    project: "/canvas",
    languages: ["typescript"],
    indexer: "lsp",
    nodes: [
      node("canvas.ts#Canvas:class", "class", "Canvas", "Canvas", true),
      node(
        "canvas.ts#Canvas.handle:method",
        "method",
        "handle",
        "Canvas.handle",
      ),
      node(
        "canvas.ts#Canvas.handleSpecial:method",
        "method",
        "handleSpecial",
        "Canvas.handleSpecial",
      ),
      node("work.ts#ordinary:function", "function", "ordinary", "ordinary"),
      node("work.ts#special:function", "function", "special", "special"),
    ],
    edges: [
      { from: "canvas.ts", to: "canvas.ts#Canvas:class", kind: "exports" },
      {
        from: "canvas.ts#Canvas:class",
        to: "canvas.ts#Canvas.handle:method",
        kind: "contains",
      },
      {
        from: "canvas.ts#Canvas:class",
        to: "canvas.ts#Canvas.handleSpecial:method",
        kind: "contains",
      },
      {
        from: "canvas.ts#Canvas.handle:method",
        to: "work.ts#ordinary:function",
        kind: "calls",
        evidence: { file: "canvas.ts", startLine: 2, startCol: 3 },
      },
      {
        from: "canvas.ts#Canvas.handleSpecial:method",
        to: "work.ts#special:function",
        kind: "calls",
        evidence: { file: "canvas.ts", startLine: 5, startCol: 3 },
      },
    ],
  };
  const output = await new SamchonGraphApplication(
    SamchonGraphMemory.from(dump),
  ).inspect_code_graph({
    question: "Show `Canvas.handle`.",
    draft: {
      reason: "A tour is the smallest request for both exact family members.",
      type: "tour",
    },
    review: "Tour is appropriate for combining the exact flow entrypoints.",
    request: {
      type: "tour",
      reinterpretations: ["Canvas.handleSpecial"],
      limit: 2,
      includeTests: false,
    },
  });
  if (output.result.type !== "tour")
    throw new Error(`Expected a tour result, got ${output.result.type}.`);
  TestValidator.equals(
    "a direct exact mention does not erase a more-specific exact reinterpretation",
    output.result.entrypoints
      .map((entry) => entry.name)
      .sort(),
    ["Canvas.handle", "Canvas.handleSpecial"],
  );
};

const node = (
  id: string,
  kind: "class" | "method" | "function",
  name: string,
  qualifiedName: string,
  exported = false,
) => ({
  id,
  kind,
  language: "typescript" as const,
  name,
  ...(qualifiedName === name ? {} : { qualifiedName }),
  file: id.slice(0, id.indexOf("#")),
  external: false,
  ...(exported ? { exported: true } : {}),
  evidence: { startLine: 1, endLine: 7 },
});
