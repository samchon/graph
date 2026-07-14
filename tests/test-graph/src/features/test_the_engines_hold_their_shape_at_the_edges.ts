import { TestValidator } from "@nestia/e2e";
import {
  buildGraphDump,
  SamchonGraphApplication,
  SamchonGraphMemory,
} from "@samchon/graph";
import type {
  ISamchonGraphDetails,
  ISamchonGraphDump,
  ISamchonGraphNode,
  ISamchonGraphTour,
  ISamchonGraphTrace,
} from "@samchon/graph";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The edges of the ported engines: the caps that fire, the hubs the flow refuses
 * to walk through, the handles that name nothing, and the evidence a graph does
 * not always carry.
 */
export const test_the_engines_hold_their_shape_at_the_edges = async () => {
  await scenario_a_tour_of_a_codebase_with_more_flows_than_slots();
  await scenario_a_handle_shaped_like_nothing_the_graph_holds();
  await scenario_a_junction_the_tour_would_not_name();
  await scenario_a_path_that_runs_past_its_depth();
  await scenario_a_doc_comment_at_every_boundary();
  await scenario_details_caps_and_ranks_what_implements_a_hub();
};

/**
 * Five seeds, four flow slots, a shared utility that terminates every chain, and
 * two entries that tell the same story: the tour keeps the flows that move, tells
 * each story once, and refuses to walk a chain through a hub that drives nothing
 * onward.
 */
const scenario_a_tour_of_a_codebase_with_more_flows_than_slots = async () => {
  const nodes: ISamchonGraphNode[] = [
    // A fan-in hub that calls nothing onward: reached from a dozen-plus sites, a
    // terminus rather than a step in the runtime chain.
    fn("src/log.ts#log:function", "log", 1),
    // Twelve callers, so the hub cut fires.
    ...Array.from({ length: 12 }, (_, index) =>
      fn(`src/caller${index}.ts#caller${index}:function`, `caller${index}`, 1),
    ),
    // Five entries, each of which drives real work.
    ...Array.from({ length: 5 }, (_, index) =>
      fn(`src/entry.ts#entry${index}:function`, `entry${index}`, 1 + index * 4),
    ),
    // Two entries that run the same chain: a synonym, not a second flow.
    fn("src/entry.ts#parse:function", "parse", 30),
    fn("src/entry.ts#safeParse:function", "safeParse", 34),
    fn("src/core.ts#validate:function", "validate", 1),
    ...Array.from({ length: 5 }, (_, index) =>
      fn(`src/work${index}.ts#work${index}:function`, `work${index}`, 1),
    ),
  ];
  const edges = [
    ...nodes
      .filter((node) => node.name.startsWith("caller"))
      .map((node) => calls(node.id, "src/log.ts#log:function")),
    ...Array.from({ length: 5 }, (_, index) => [
      calls(`src/entry.ts#entry${index}:function`, `src/work${index}.ts#work${index}:function`),
      // Every flow also passes through the shared terminus, which the tour drops.
      calls(`src/entry.ts#entry${index}:function`, "src/log.ts#log:function"),
    ]).flat(),
    // The two synonym entries land in exactly the same place.
    calls("src/entry.ts#parse:function", "src/core.ts#validate:function"),
    calls("src/entry.ts#safeParse:function", "src/core.ts#validate:function"),
    // A published surface, so the centrality product has a `published` term.
    ...nodes.map((node) => exportsOf(node.file, node.id)),
  ];
  const app = new SamchonGraphApplication(
    SamchonGraphMemory.from(dumpOf("/flows", nodes, edges)),
  );
  const tour = (
    await app.inspect_code_graph({
      question: "how does an entry reach the work",
      draft: { reason: "Orientation.", type: "tour" },
      review: "Tour.",
      request: { type: "tour", reinterpretations: [] },
    })
  ).result as ISamchonGraphTour;

  TestValidator.predicate(
    "a tour tells at most four flows, however many seeds could start one",
    tour.primaryFlow.length <= 4,
  );
  TestValidator.equals(
    "a fan-in hub that drives nothing onward is not a step in the chain",
    tour.primaryFlow.flatMap((flow) =>
      flow.reached.filter((node) => node.name === "log"),
    ),
    [],
  );
  // A candidate whose trace lands where a kept flow already landed is a synonym.
  const toldValidate = tour.primaryFlow.filter((flow) =>
    flow.reached.some((node) => node.name === "validate"),
  );
  TestValidator.predicate(
    "two entries that run the same chain are one flow",
    toldValidate.length <= 1,
  );
};

/**
 * The handle forms that name nothing: a bare dot, a trailing dot, an id with no
 * kind, an id with nothing after the hash. None of them may be answered with a
 * guess, and none of them may throw.
 */
const scenario_a_handle_shaped_like_nothing_the_graph_holds = async () => {
  const nodes = [
    fn("src/a.ts#alpha:function", "alpha", 1),
    // Two symbols whose qualified names share a `.suffix` the graph declares
    // twice: `Deep.twin` is not a qualified name of either, so the exact form
    // misses and the suffix match finds both.
    method("src/a.ts#Alpha.Deep.twin:method", "twin", "Alpha.Deep.twin", 5),
    method("src/b.ts#Beta.Deep.twin:method", "twin", "Beta.Deep.twin", 5),
  ];
  const app = new SamchonGraphApplication(
    SamchonGraphMemory.from(dumpOf("/handles", nodes, [])),
  );
  const traceOf = async (from: string): Promise<ISamchonGraphTrace> =>
    (
      await app.inspect_code_graph({
        question: `trace ${from}`,
        draft: { reason: "One trace.", type: "trace" },
        review: "Trace.",
        request: { type: "trace", from },
      })
    ).result as ISamchonGraphTrace;

  for (const handle of [".", "alpha.", "src/a.ts#", "#alpha", "src/a.ts#alpha"]) {
    const trace = await traceOf(handle);
    TestValidator.predicate(
      `a handle shaped like \`${handle}\` is answered without a guess`,
      trace.start === undefined || trace.start.id === "src/a.ts#alpha:function",
    );
  }
  // An id whose file is one refactor stale still names its symbol.
  TestValidator.equals(
    "an id with no kind still names its symbol",
    (await traceOf("src/moved.ts#alpha")).start?.id,
    "src/a.ts#alpha:function",
  );
  // A `.suffix` two qualified names end with is a name the graph declares twice.
  TestValidator.equals(
    "a dotted suffix the graph declares twice comes back as candidates",
    (await traceOf("Deep.twin")).candidates?.length,
    2,
  );
};

/**
 * A junction the result must not name: a file container is not a symbol to look
 * at next, and a shared symbol the graph carries no span for still names itself.
 */
const scenario_a_junction_the_tour_would_not_name = async () => {
  const withSpan = fn("src/state.ts#state:variable", "state", 1);
  const spanless: ISamchonGraphNode = {
    id: "src/state.ts#spanless:variable",
    kind: "variable",
    language: "typescript",
    name: "spanless",
    file: "src/state.ts",
    external: false,
    exported: true,
  };
  const nodes = [
    fn("src/a.ts#left:function", "left", 1),
    fn("src/b.ts#right:function", "right", 1),
    { ...withSpan, kind: "variable" as const },
    spanless,
  ];
  const edges = [
    // Both ends touch the state, and the state has a span.
    accesses("src/a.ts#left:function", "src/state.ts#state:variable"),
    accesses("src/b.ts#right:function", "src/state.ts#state:variable"),
    // Both ends touch a symbol the graph carries no span for.
    accesses("src/a.ts#left:function", "src/state.ts#spanless:variable"),
    accesses("src/b.ts#right:function", "src/state.ts#spanless:variable"),
    // Both ends are published by the same barrel: an `exports` edge carries no
    // span, and a file is not a symbol to look at next.
    exportsOf("src/index.ts", "src/a.ts#left:function"),
    exportsOf("src/index.ts", "src/b.ts#right:function"),
  ];
  const app = new SamchonGraphApplication(
    SamchonGraphMemory.from(dumpOf("/junctions", nodes, edges)),
  );
  const trace = (
    await app.inspect_code_graph({
      question: "how does left reach right",
      draft: { reason: "Both ends are known.", type: "trace" },
      review: "Path mode.",
      request: { type: "trace", from: "left", to: "right" },
    })
  ).result as ISamchonGraphTrace;

  const named = (trace.junctions ?? []).map((junction) => junction.name);
  TestValidator.predicate(
    "the state both ends touch is the seam",
    named.includes("state"),
  );
  TestValidator.predicate(
    "a symbol with no span still names itself as a junction",
    named.includes("spanless"),
  );
  TestValidator.equals(
    "the file that publishes both ends is not a symbol to look at next",
    named.filter((name) => name.endsWith(".ts")),
    [],
  );
};

/** A path search stops at its depth cap rather than walking the whole graph. */
const scenario_a_path_that_runs_past_its_depth = async () => {
  const length = 16;
  const nodes = Array.from({ length }, (_, index) =>
    fn(`src/chain.ts#step${index}:function`, `step${index}`, index + 1),
  );
  const edges = Array.from({ length: length - 1 }, (_, index) =>
    calls(`src/chain.ts#step${index}:function`, `src/chain.ts#step${index + 1}:function`),
  );
  const app = new SamchonGraphApplication(
    SamchonGraphMemory.from(dumpOf("/chain", nodes, edges)),
  );
  const trace = (
    await app.inspect_code_graph({
      question: "how does step0 reach step15",
      draft: { reason: "Both ends are known.", type: "trace" },
      review: "Path mode.",
      request: { type: "trace", from: "step0", to: "step15" },
    })
  ).result as ISamchonGraphTrace;
  TestValidator.equals(
    "a target past the path cap is not reached by walking the whole graph",
    trace.path,
    [],
  );
};

/** Every boundary the doc reader has to hold: the file's edge, and the sentence's. */
const scenario_a_doc_comment_at_every_boundary = async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-doc2-"));
  write(root, "src/edges.ts", [
    // A declaration on the first line has nothing above it to read.
    "export function first(): void {}",
    "",
    "/**",
    " * A first sentence with no terminating period",
    " */",
    "",
    "export function noPeriod(): void {}",
    "",
    "/**",
    ` * ${"a very long first sentence that runs well past what an index should carry ".repeat(4)}and then finally stops.`,
    " */",
    "export function tooLong(): void {}",
  ]);
  const app = new SamchonGraphApplication(
    SamchonGraphMemory.from(
      await buildGraphDump({ cwd: root, mode: "static", languages: ["typescript"] }),
    ),
  );
  const details = (
    await app.inspect_code_graph({
      question: "what do these do",
      draft: { reason: "Details.", type: "details" },
      review: "Details.",
      request: { type: "details", handles: ["first", "noPeriod", "tooLong"] },
    })
  ).result as ISamchonGraphDetails;
  const docOf = (name: string): string | undefined =>
    details.nodes.find((node) => node.name === name)?.doc;

  TestValidator.equals(
    "a declaration on the first line has nothing above it",
    docOf("first"),
    undefined,
  );
  // A blank line between the comment and the declaration does not detach it.
  TestValidator.equals(
    "a doc with no terminating period is the whole prose",
    docOf("noPeriod"),
    "A first sentence with no terminating period",
  );
  TestValidator.predicate(
    "and a sentence that runs away is cut, not carried",
    (docOf("tooLong")?.length ?? 0) <= 201 && docOf("tooLong")?.endsWith("…") === true,
  );
};

/**
 * `details` is what a caller asks when it actually wants the implementors a trace
 * refused to dump into a flow — and the list it gives is capped and ranked, with
 * a reference from a test file below every reference from the code under test.
 */
const scenario_details_caps_and_ranks_what_implements_a_hub = async () => {
  const nodes: ISamchonGraphNode[] = [
    method("src/api.ts#Api.run:method", "run", "Api.run", 1),
    ...Array.from({ length: 6 }, (_, index) =>
      method(`src/impl${index}.ts#Impl${index}.run:method`, "run", `Impl${index}.run`, 1),
    ),
    // A test declaration that also implements it: last, whatever the source order.
    method("test/api.spec.ts#Fake.run:method", "run", "Fake.run", 1),
    fn("src/caller.ts#caller:function", "caller", 1),
    // A dependency the graph carries no span for, so its reference has none.
    {
      id: "src/api.ts#marker:variable",
      kind: "variable",
      language: "typescript",
      name: "marker",
      file: "src/api.ts",
      external: false,
    },
  ];
  const edges = [
    ...Array.from({ length: 6 }, (_, index) =>
      implementsOf(`src/impl${index}.ts#Impl${index}.run:method`, "src/api.ts#Api.run:method", index + 1),
    ),
    implementsOf("test/api.spec.ts#Fake.run:method", "src/api.ts#Api.run:method", 0),
    calls("src/caller.ts#caller:function", "src/api.ts#Api.run:method"),
    // An edge with no evidence at all: the anchor list must skip it rather than
    // cite a span it does not hold.
    { from: "src/api.ts#Api.run:method", to: "src/api.ts#marker:variable", kind: "accesses" as const },
  ];
  const app = new SamchonGraphApplication(
    SamchonGraphMemory.from(dumpOf("/impls", nodes, edges)),
  );
  const details = (
    await app.inspect_code_graph({
      question: "what implements Api.run",
      draft: { reason: "Details answers implementedBy.", type: "details" },
      review: "Details.",
      request: {
        type: "details",
        handles: ["Api.run"],
        dependencyLimit: 4,
        neighbors: true,
        neighborLimit: 3,
      },
    })
  ).result as ISamchonGraphDetails;
  const node = details.nodes[0];

  TestValidator.equals(
    "the implementor list is capped, not dumped",
    node?.implementedBy?.length,
    4,
  );
  TestValidator.equals(
    "and a test declaration is not who implements it in production",
    node?.implementedBy?.filter((ref) => ref.file.startsWith("test/")),
    [],
  );
};

const dumpOf = (
  project: string,
  nodes: ISamchonGraphNode[],
  edges: ISamchonGraphDump["edges"],
): ISamchonGraphDump => ({
  project,
  languages: ["typescript"],
  indexer: "static",
  nodes,
  edges,
});

const fn = (id: string, name: string, line: number): ISamchonGraphNode => ({
  id,
  kind: id.endsWith(":variable") ? "variable" : "function",
  language: "typescript",
  name,
  file: id.slice(0, id.indexOf("#")),
  external: false,
  exported: true,
  evidence: { startLine: line, endLine: line + 2 },
});

const method = (
  id: string,
  name: string,
  qualifiedName: string,
  line: number,
): ISamchonGraphNode => ({
  id,
  kind: "method",
  language: "typescript",
  name,
  qualifiedName,
  file: id.slice(0, id.indexOf("#")),
  external: false,
  exported: true,
  evidence: { startLine: line, endLine: line + 2 },
});

const calls = (from: string, to: string) => ({
  from,
  to,
  kind: "calls" as const,
  evidence: { startLine: 2 },
});

const accesses = (from: string, to: string) => ({
  from,
  to,
  kind: "accesses" as const,
  evidence: { startLine: 3 },
});

const implementsOf = (from: string, to: string, line: number) => ({
  from,
  to,
  kind: "implements" as const,
  evidence: { startLine: line },
});

const exportsOf = (from: string, to: string) => ({
  from,
  to,
  kind: "exports" as const,
});

const write = (root: string, file: string, lines: string[]): void => {
  const abs = path.join(root, file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${lines.join("\n")}\n`);
};
