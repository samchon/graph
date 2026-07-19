import {
  type GraphSitterLanguage,
  graphSitterParts,
  type IGraphSitterEdge,
  type IGraphSitterFile,
  type IGraphSitterNode,
  isGraphSitterLanguage,
} from "@samchon/graph-sitter";
import path from "node:path";
import { ISamchonGraphEdge, ISamchonGraphNode } from "../structures";
import { GraphLanguage } from "../typings";
import { projectRelative, readText } from "../utils/fs";
import { assignSemanticIdentities } from "./assignSemanticIdentities";
import { IBuildGraphOptions } from "./IBuildGraphOptions";
import { IStaticGraphParts } from "./IStaticGraphParts";
import { languageOf } from "./languages";
import { selectGraphSources } from "./selectGraphSources";

/**
 * Discover a project snapshot and delegate its best-effort syntax extraction to
 * the isolated graph-sitter package.
 */
export function staticGraphParts(
  options: IBuildGraphOptions = {},
  selectedFiles?: readonly string[],
): IStaticGraphParts {
  const root = path.resolve(options.cwd ?? process.cwd());
  const discovered = selectedFiles ?? selectGraphSources(root, options).files;
  const files: IGraphSitterFile[] = [];
  for (const absolutePath of discovered) {
    const language = languageOf(absolutePath);
    // `discovered` comes from `walkSourceFiles(allExtensions(...))`, so every
    // path's extension maps — through the same `LANGUAGE_SPECS` registry that
    // `allExtensions` and `languageOf` share — to a real (non-`unknown`)
    // language, and `GraphSitterLanguage` covers every non-`unknown`
    // `GraphLanguage` (the LanguageContractParity assertion below). This
    // narrowing guard therefore never continues at runtime; it only satisfies
    // the compiler that `language` is a `GraphSitterLanguage`.
    /* c8 ignore next */
    if (!isGraphSitterLanguage(language)) continue;
    const source = readText(absolutePath);
    /* c8 ignore next */
    if (source === undefined) continue;
    files.push({
      absolutePath,
      relativePath: projectRelative(root, absolutePath),
      language,
      source,
    });
  }
  const parts = graphSitterParts({ root, files });
  assignSemanticIdentities(parts.nodes, parts.edges);
  return parts;
}

// The package boundary is intentionally structural and acyclic. These
// bidirectional checks make any raw node, edge, or language drift a compile
// failure before an adapter can silently weaken the public graph contract.
type Assert<T extends true> = T;
type NodeContractParity = Assert<
  IGraphSitterNode extends ISamchonGraphNode
    ? ISamchonGraphNode extends IGraphSitterNode
      ? true
      : false
    : false
>;
type EdgeContractParity = Assert<
  IGraphSitterEdge extends ISamchonGraphEdge
    ? ISamchonGraphEdge extends IGraphSitterEdge
      ? true
      : false
    : false
>;
type LanguageContractParity = Assert<
  GraphSitterLanguage extends Exclude<GraphLanguage, "unknown">
    ? Exclude<GraphLanguage, "unknown"> extends GraphSitterLanguage
      ? true
      : false
    : false
>;
