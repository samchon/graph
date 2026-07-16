import { TestValidator } from "@nestia/e2e";
import {
  ISamchonGraphDump,
  SamchonGraphApplication,
  SamchonGraphMemory,
} from "@samchon/graph";

/**
 * Exact handles own their named share and every remaining candidate competes
 * in the same canonical flat-term ranking lane.
 */
export const test_tour_uses_one_flat_term_ranking_lane = async () => {
  const nodes: ISamchonGraphDump["nodes"] = [];
  const edges: ISamchonGraphDump["edges"] = [];
  const add = (id: string, name: string, file: string, exported: boolean) => {
    nodes.push({
      id,
      kind: "function",
      language: "typescript",
      name,
      file,
      external: false,
      ...(exported ? { exported: true } : {}),
      evidence: { startLine: 1, endLine: 3 },
    });
    if (exported) edges.push({ from: file, to: id, kind: "exports" });
  };
  const call = (from: string, to: string, file: string) =>
    edges.push({
      from,
      to,
      kind: "calls",
      evidence: { file, startLine: 2 },
    });

  for (const [index, name] of [
    "ExactAlpha",
    "ExactBeta",
    "ExactGamma",
    "ExactDelta",
  ].entries()) {
    const entry = `exact${index}.ts#${name}:function`;
    const worker = `exact-work${index}.ts#exactWork${index}:function`;
    add(entry, name, `exact${index}.ts`, true);
    add(worker, `exactWork${index}`, `exact-work${index}.ts`, false);
    call(entry, worker, `exact${index}.ts`);
  }
  for (const [index, name] of [
    "CanvasRender",
    "SceneMutate",
    "CacheInvalidate",
  ].entries()) {
    const entry = `facet${index}.ts#${name}:function`;
    const worker = `facet-work${index}.ts#facetWork${index}:function`;
    add(entry, name, `facet${index}.ts`, true);
    add(worker, `facetWork${index}`, `facet-work${index}.ts`, false);
    call(entry, worker, `facet${index}.ts`);
  }
  // It matches one prose clause more literally than CanvasRender, but it runs
  // nothing and therefore cannot spend an executable tour seat.
  add(
    "leaf.ts#CanvasRenderLeaf:function",
    "CanvasRenderLeaf",
    "leaf.ts",
    true,
  );
  // These are deliberately stronger structural paths. Before the regression
  // fix they filled all three seats left after the two-name share, even though
  // three executable prose facets described exactly what the caller wanted.
  for (const [index, name] of [
    "ServeAlpha",
    "ServeBeta",
    "ServeGamma",
  ].entries()) {
    const entry = `central${index}.ts#${name}:function`;
    const worker = `runtime${index}.ts#runtime${index}:function`;
    const deep = `deep${index}.ts#deep${index}:function`;
    add(entry, name, `central${index}.ts`, true);
    add(worker, `runtime${index}`, `runtime${index}.ts`, false);
    add(deep, `deep${index}`, `deep${index}.ts`, false);
    call(entry, worker, `central${index}.ts`);
    call(worker, deep, `runtime${index}.ts`);
  }

  const output = await new SamchonGraphApplication(
    SamchonGraphMemory.from({
      project: "/repo",
      languages: ["typescript"],
      indexer: "lsp",
      nodes,
      edges,
    }),
  ).inspect_code_graph({
    question: "Show the exact entrypoints and the canvas update facets.",
    draft: {
      reason: "A tour is the smallest request for entrypoints and update facets.",
      type: "tour",
    },
    review: "Tour is appropriate for ranking entrypoints and update facets.",
    request: {
      type: "tour",
      reinterpretations: [
        "ExactAlpha",
        "ExactBeta",
        "ExactGamma",
        "ExactDelta",
        "canvas render",
        "scene mutate",
        "cache invalidate",
        "canvas render leaf",
      ],
      limit: 5,
      includeTests: false,
    },
  });
  if (output.result.type !== "tour")
    throw new Error(`Expected a tour result, got ${output.result.type}.`);
  const names = output.result.entrypoints.map((node) => node.name);

  TestValidator.equals(
    "flat terms do not create a privileged executable soft-hint lane",
    {
      facets: names
        .filter((name) =>
          ["CanvasRender", "SceneMutate", "CacheInvalidate"].includes(name),
        )
        .sort(),
      exact: names.filter((name) => name.startsWith("Exact")).length,
      leaf: names.includes("CanvasRenderLeaf"),
    },
    {
      facets: ["CacheInvalidate", "SceneMutate"],
      exact: 2,
      leaf: true,
    },
  );
};
