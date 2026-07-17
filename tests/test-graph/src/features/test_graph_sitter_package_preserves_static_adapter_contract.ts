import fs from "node:fs";
import path from "node:path";

import { TestValidator } from "@nestia/e2e";

import { GraphPaths } from "../internal/GraphPaths";
import {
  type IStaticGraphParts,
  staticGraphParts,
} from "@samchon/graph";
import {
  graphSitterParts,
  type IGraphSitterParts,
  isGraphSitterLanguage,
} from "@samchon/graph-sitter";

export const test_graph_sitter_package_preserves_static_adapter_contract = () => {
  const root = GraphPaths.createTempDirectory("samchon-graph-sitter-boundary-");
  try {
    const absolutePath = path.join(root, "entry.ts");
    const source = [
      "export function target() {}",
      "export function entry() {",
      "  target();",
      "}",
    ].join("\n");
    fs.writeFileSync(absolutePath, source);

    const direct = graphSitterParts({
      root,
      files: [
        {
          absolutePath,
          relativePath: "entry.ts",
          language: "typescript",
          source,
        },
      ],
    });
    const adapted = staticGraphParts({
      cwd: root,
      languages: ["typescript"],
    });
    TestValidator.equals(
      "graph adapter preserves graph-sitter raw facts",
      comparable(adapted),
      comparable(direct),
    );
    TestValidator.equals(
      "graph-sitter registry excludes withdrawn and unknown languages",
      [
        isGraphSitterLanguage("typescript"),
        isGraphSitterLanguage("bash"),
        isGraphSitterLanguage("unknown"),
      ],
      [true, false, false],
    );

    const empty = graphSitterParts({ root, files: [] });
    TestValidator.equals(
      "empty graph-sitter snapshots report the same fallback warning",
      {
        nodes: empty.nodes,
        edges: empty.edges,
        warnings: empty.warnings,
      },
      {
        nodes: [],
        edges: [],
        warnings: ["No supported source files were found."],
      },
    );
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
};

function comparable(parts: IStaticGraphParts | IGraphSitterParts) {
  return {
    root: parts.root,
    files: parts.files,
    sources: [...parts.sources],
    languages: parts.languages,
    nodes: parts.nodes,
    edges: parts.edges,
    warnings: parts.warnings,
  };
}
