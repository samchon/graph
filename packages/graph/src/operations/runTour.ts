import { GraphMemory } from "../model/GraphMemory";
import { IGraphTour } from "../structures";
import { bound, isTestPath, resultGuide, resultNext, summaryOf } from "./common";
import { runEntrypoints } from "./runEntrypoints";
import { runTrace } from "./runTrace";

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 16;

export function runTour(graph: GraphMemory, props: IGraphTour.IRequest): IGraphTour {
  const limit = bound(props.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const entrypoints = runEntrypoints(graph, {
    type: "entrypoints",
    query: props.question ?? "project architecture",
    language: props.language,
    limit,
  }).ranked;

  const primaryFlow: string[] = [];
  for (const entry of entrypoints.slice(0, 3)) {
    const trace = runTrace(graph, {
      type: "trace",
      from: entry.id,
      direction: "forward",
      focus: "execution",
      maxDepth: 2,
      maxNodes: 8,
    });
    primaryFlow.push(...trace.steps!);
  }

  const nearbyPaths = entrypoints
    .flatMap((entry) => [
      ...graph.outgoing(entry.id).map((edge) => graph.node(edge.to)),
      ...graph.incoming(entry.id).map((edge) => graph.node(edge.from)),
    ])
    .filter(
      (node): node is NonNullable<typeof node> =>
        node !== undefined && node.kind !== "file" && !node.external,
    )
    .slice(0, 10)
    .map(summaryOf);

  const testAnchors = graph.nodes
    .filter((node) => node.kind !== "file" && isTestPath(node.file))
    .slice(0, 8)
    .map(summaryOf);

  const answerAnchors = uniqueById([
    ...entrypoints,
    ...nearbyPaths,
    ...testAnchors,
  ]).slice(0, 16);

  return {
    type: "tour",
    question: props.question,
    entrypoints,
    primaryFlow,
    nearbyPaths,
    testAnchors,
    answerAnchors,
    diagnostics: graph.diagnostics.slice(0, 12),
    next: resultNext(
      "answer",
      "This tour is the complete index-level answer surface for broad orientation.",
    ),
    guide: resultGuide(
      "Use the tour as answer-ready evidence. Do not split broad orientation into extra calls unless a named missing symbol remains.",
    ),
  };
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}
