import { TestValidator } from "@nestia/e2e";
import { SamchonGraphApplication, SamchonGraphMemory } from "@samchon/graph";
import type { ISamchonGraphDump, ISamchonGraphTrace } from "@samchon/graph";

/**
 * When no call path runs between two symbols, say why.
 *
 * A call graph cannot cross a callback: a handler registers a listener on an
 * emitter, the emitter's `emit()` runs whatever the registration put in an
 * array, and no call edge crosses that array. An empty `path` teaches the model
 * that the tool is broken; the symbols both ends *touch* teach it what the tool
 * knows — and that is an edge from each end to the same node, not a guess.
 *
 * A junction is not a path. It is the symbol to look at next, with the two edges
 * that make it the seam, and `next` says to trace it.
 */
export const test_trace_names_the_junction_when_no_path_exists = async () => {
  const dump: ISamchonGraphDump = {
    project: "/emitter",
    languages: ["typescript"],
    indexer: "static",
    nodes: [
      symbol("src/app.ts#App.onPointerDown:method", "method", "onPointerDown", "App.onPointerDown", 10),
      symbol("src/store.ts#Store.emitIncrement:method", "method", "emitIncrement", "Store.emitIncrement", 30),
      // The seam: state both ends hold onto rather than merely call.
      symbol("src/store.ts#Store.onIncrementEmitter:property", "property", "onIncrementEmitter", "Store.onIncrementEmitter", 20),
      // A shared leaf helper both ends merely call: noise, not a seam.
      symbol("src/util.ts#log:function", "function", "log", undefined, 1),
    ],
    edges: [
      edge("src/app.ts#App.onPointerDown:method", "src/store.ts#Store.onIncrementEmitter:property", "accesses"),
      edge("src/store.ts#Store.emitIncrement:method", "src/store.ts#Store.onIncrementEmitter:property", "accesses"),
      edge("src/app.ts#App.onPointerDown:method", "src/util.ts#log:function", "calls"),
      edge("src/store.ts#Store.emitIncrement:method", "src/util.ts#log:function", "calls"),
    ],
  };
  const app = new SamchonGraphApplication(SamchonGraphMemory.from(dump));
  const output = await app.inspect_code_graph({
    question: "How does a pointer down reach the store's increment?",
    draft: { reason: "Both ends are known, so ask for the path.", type: "trace" },
    review: "Path mode is the one call that answers it.",
    request: {
      type: "trace",
      from: "App.onPointerDown",
      to: "Store.emitIncrement",
    },
  });
  const trace = output.result as ISamchonGraphTrace;

  TestValidator.equals("no call path runs between the two ends", trace.path, []);
  TestValidator.predicate(
    "the seam both ends touch is named",
    (trace.junctions ?? []).some(
      (junction) => junction.name === "Store.onIncrementEmitter",
    ),
  );
  // A shared emitter, store, or registry is the seam; a shared leaf helper is
  // noise. What both ends hold onto rather than merely call comes first.
  TestValidator.equals(
    "the state both ends hold onto ranks ahead of the helper they both call",
    trace.junctions?.[0]?.name,
    "Store.onIncrementEmitter",
  );
  TestValidator.equals(
    "the junction records how each end touches it",
    trace.junctions?.[0]?.fromStart.kind,
    "accesses",
  );
  TestValidator.equals(
    "an empty path with a junction says which call to make instead",
    output.next.action,
    "inspect",
  );
  TestValidator.equals(
    "and it names the request that crosses the seam",
    output.next.request,
    "trace",
  );

  await scenario_two_ends_that_touch_nothing_in_common();
};

/**
 * Two ends that touch nothing in common hold no connection the graph can name,
 * so the honest answer is that the graph holds none — and `next` says to leave
 * rather than to make a call that cannot help.
 */
const scenario_two_ends_that_touch_nothing_in_common = async () => {
  const dump: ISamchonGraphDump = {
    project: "/islands",
    languages: ["typescript"],
    indexer: "static",
    nodes: [
      symbol("src/a.ts#alpha:function", "function", "alpha", undefined, 1),
      symbol("src/b.ts#beta:function", "function", "beta", undefined, 1),
    ],
    edges: [],
  };
  const app = new SamchonGraphApplication(SamchonGraphMemory.from(dump));
  const output = await app.inspect_code_graph({
    question: "How does alpha reach beta?",
    draft: { reason: "Both ends are known.", type: "trace" },
    review: "Path mode.",
    request: { type: "trace", from: "alpha", to: "beta" },
  });
  const trace = output.result as ISamchonGraphTrace;
  TestValidator.equals("no path exists", trace.path, []);
  TestValidator.equals("and no junction is invented", trace.junctions, undefined);
  TestValidator.equals(
    "two unconnected ends send the caller outside the graph",
    output.next.action,
    "outside",
  );
};

const symbol = (
  id: string,
  kind: string,
  name: string,
  qualifiedName: string | undefined,
  line: number,
) => ({
  id,
  kind: kind as "method",
  language: "typescript" as const,
  name,
  ...(qualifiedName !== undefined ? { qualifiedName } : {}),
  file: id.slice(0, id.indexOf("#")),
  external: false,
  exported: true,
  evidence: { startLine: line, endLine: line },
});

const edge = (from: string, to: string, kind: string) => ({
  from,
  to,
  kind: kind as "calls",
  evidence: { startLine: 5 },
});
