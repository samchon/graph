import { ISamchonGraphEdge, ISamchonGraphNode } from "../structures";
import { GraphLanguage } from "../typings";

/**
 * A project's static parse, before the graph is finalized and put on the wire.
 *
 * A hybrid build merges this into its language-server slice and finalizes the
 * two together, so the §4k derivation — the closure flag, and the export surface
 * followed through the project's barrels — runs once across the whole project
 * rather than once per lane.
 */
export interface IStaticGraphParts {
  /** Absolute path of the project root the parse ran over. */
  root: string;

  /** Absolute paths of every source file the walk found. */
  files: string[];

  /** Exact source text the static parser consumed, keyed by absolute path. */
  sources: Map<string, string>;

  /** The source languages present in the parse. */
  languages: GraphLanguage[];

  /** Every declaration the parse recorded, spans intact. */
  nodes: ISamchonGraphNode[];

  /** Every relationship the parse resolved, spans intact. */
  edges: ISamchonGraphEdge[];

  /** Non-fatal problems encountered while parsing. */
  warnings: string[];
}
