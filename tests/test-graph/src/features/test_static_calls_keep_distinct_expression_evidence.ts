import fs from "node:fs";
import path from "node:path";

import { TestValidator } from "@nestia/e2e";

import { GraphPaths } from "../internal/GraphPaths";
import {
  buildGraphDump,
  SamchonGraphApplication,
  SamchonGraphMemory,
} from "@samchon/graph";

export const test_static_calls_keep_distinct_expression_evidence = async () => {
  const root = GraphPaths.createTempDirectory("samchon-static-sites-");
  fs.writeFileSync(
    path.join(root, "flow.ts"),
    [
      "export function first() {}",
      "export function second() {}",
      "export function entry() {",
      "  first();",
      "  second();",
      "}",
    ].join("\n"),
  );
  const dump = await buildGraphDump({
    cwd: root,
    mode: "static",
    languages: ["typescript"],
  });
  const entry = dump.nodes.find((node) => node.name === "entry");
  const called = dump.edges
    .filter((edge) => edge.kind === "calls" && edge.from === entry?.id)
    .map((edge) => ({
      name: dump.nodes.find((node) => node.id === edge.to)?.name,
      line: edge.evidence?.startLine,
      column: edge.evidence?.startCol,
    }))
    .sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  TestValidator.equals(
    "static calls cite their distinct expression sites",
    called,
    [
      { name: "first", line: 4, column: 3 },
      { name: "second", line: 5, column: 3 },
    ],
  );

  const tour = await new SamchonGraphApplication(
    SamchonGraphMemory.from(dump),
  ).inspect_code_graph({
    question: "Show entry.",
    draft: {
      reason: "A tour is the smallest request for the entry flow.",
      type: "tour",
    },
    review: "Tour is appropriate for the entry's runtime flow.",
    request: {
      type: "tour",
      reinterpretations: ["entry"],
      limit: 1,
      includeTests: false,
    },
  });
  if (tour.result.type !== "tour")
    throw new Error(`Expected a tour result, got ${tour.result.type}.`);
  TestValidator.equals(
    "flow compaction keeps calls from different static expression sites",
    tour.result.primaryFlow[0]?.reached.map((node) => node.name),
    ["first", "second"],
  );
};
