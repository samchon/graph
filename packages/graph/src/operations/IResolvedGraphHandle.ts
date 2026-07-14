import { ISamchonGraphNode } from "../structures";

/**
 * What a handle resolved to: one node, or the several a name the project
 * declares more than once could mean.
 *
 * A name the graph knows twice is not a name the graph does not know, so the
 * candidates come back rather than an empty result — ranked by what the package
 * publishes, so the one a caller means is the one it reads first.
 */
export interface IResolvedGraphHandle {
  /** The single node the handle names, when it names exactly one. */
  node?: ISamchonGraphNode;

  /** The nodes it could mean, ranked, when it names several. */
  candidates?: ISamchonGraphNode[];
}
