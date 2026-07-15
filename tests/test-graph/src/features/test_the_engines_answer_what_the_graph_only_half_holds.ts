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
 * A real index is not uniform: a span goes missing, an edge carries no evidence,
 * a declaration is a dependency's, a symbol lives in a bundled `.d.ts`. None of
 * that may make the engines invent a fact, and none of it may make them throw.
 */
export const test_the_engines_answer_what_the_graph_only_half_holds = async () => {
  await scenario_a_tour_over_a_graph_that_is_missing_its_evidence();
  await scenario_a_junction_the_graph_will_not_hand_back();
  await scenario_a_dispatch_the_index_carries_no_span_for();
  await scenario_details_over_neighbours_the_graph_half_holds();
  await scenario_a_file_qualified_handle_two_files_answer_to();
  await scenario_a_doc_whose_span_the_source_moved_out_from_under();
  await scenario_a_comment_that_documents_nothing();
  await scenario_a_flow_that_runs_off_the_end_of_the_tour();
  await scenario_an_ambiguous_handle_the_graph_holds_no_span_for();
};

/**
 * A comment above a declaration is not necessarily its documentation: a dangling
 * close with no opening above it, and a block whose whole content is a tag, both
 * say nothing about what the symbol is for. An index that reported them anyway
 * would be putting prose in the reader's mouth.
 */
const scenario_a_comment_that_documents_nothing = async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-nodoc-"));
  // The file opens on a dangling `*/`, so the walk upward from the declaration
  // finds a line that closes a comment and never finds one that opens it.
  write(root, "src/dangling.ts", [" */", "export function dangling(): void {}"]);
  write(root, "src/tagged.ts", [
    "/**",
    " * @param nothing",
    " */",
    "export function tagged(): void {}",
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
      request: { type: "details", handles: ["dangling", "tagged"] },
    })
  ).result as ISamchonGraphDetails;
  TestValidator.equals(
    "a comment that never opened documents nothing",
    details.nodes.find((node) => node.name === "dangling")?.doc,
    undefined,
  );
  TestValidator.equals(
    "and a block whose whole content is a tag says nothing the reader needs",
    details.nodes.find((node) => node.name === "tagged")?.doc,
    undefined,
  );
};

/**
 * A tour is a light, index-level overview, and it stays one: a flow that walks
 * past the tour's own cap says so rather than pretending it reached the end, and
 * a flow whose every step is a shared terminus is not a second story.
 */
const scenario_a_flow_that_runs_off_the_end_of_the_tour = async () => {
  const width = 24;
  const nodes: ISamchonGraphNode[] = [
    fn("src/entry.ts#deepEntry:function", "deepEntry", 1),
    ...Array.from({ length: width }, (_, index) =>
      fn(`src/deep${index}.ts#deep${index}:function`, `deep${index}`, 1),
    ),
    // A second entry whose only callee is a shared terminus the tour drops, so
    // its flow lands nowhere the tour has not already been.
    fn("src/entry.ts#thinEntry:function", "thinEntry", 20),
    fn("src/log.ts#log:function", "log", 1),
    ...Array.from({ length: 12 }, (_, index) =>
      fn(`src/c${index}.ts#c${index}:function`, `c${index}`, 1),
    ),
  ];
  const edges = [
    // One entry that fans out past the tour's node cap.
    ...Array.from({ length: width }, (_, index) =>
      calls("src/entry.ts#deepEntry:function", `src/deep${index}.ts#deep${index}:function`),
    ),
    calls("src/entry.ts#thinEntry:function", "src/log.ts#log:function"),
    // Twelve callers make the terminus a shared utility the flow walks around.
    ...Array.from({ length: 12 }, (_, index) =>
      calls(`src/c${index}.ts#c${index}:function`, "src/log.ts#log:function"),
    ),
    ...nodes.map((node) => exportsOf(node.file, node.id)),
  ];
  const app = new SamchonGraphApplication(
    SamchonGraphMemory.from(dumpOf("/deep", nodes, edges)),
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
    "a flow that walks past the tour's cap says so",
    tour.primaryFlow.some((flow) => flow.truncated === true),
  );
  TestValidator.equals(
    "and the tour reports that it capped something",
    tour.truncated,
    true,
  );
  TestValidator.equals(
    "a flow whose every step is a shared terminus tells no second story",
    tour.primaryFlow.filter((flow) => flow.start.name === "thinEntry"),
    [],
  );

  // A walk that moves and arrives nowhere has nothing to tell either. `reached`
  // is what a flow is *for* — it is the handles to go on with — and a symbol that
  // only calls itself reaches none the tour did not already have.
  const selfCalling: ISamchonGraphNode[] = [
    fn("src/entry.ts#drive:function", "drive", 1),
    fn("src/work.ts#work:function", "work", 1),
    fn("src/entry.ts#recurse:function", "recurse", 10),
  ];
  const spinning = new SamchonGraphApplication(
    SamchonGraphMemory.from(
      dumpOf("/spin", selfCalling, [
        calls("src/entry.ts#drive:function", "src/work.ts#work:function"),
        calls("src/entry.ts#recurse:function", "src/entry.ts#recurse:function"),
        ...selfCalling.map((node) => exportsOf(node.file, node.id)),
      ]),
    ),
  );
  const spun = (
    await spinning.inspect_code_graph({
      question: "how does the entry reach the work",
      draft: { reason: "Orientation.", type: "tour" },
      review: "Tour.",
      request: { type: "tour", reinterpretations: [] },
    })
  ).result as ISamchonGraphTour;
  TestValidator.predicate(
    "the flow that arrives somewhere is told",
    spun.primaryFlow.some((flow) => flow.start.name === "drive"),
  );
  TestValidator.equals(
    "and the walk that only calls itself is not",
    spun.primaryFlow.filter((flow) => flow.start.name === "recurse"),
    [],
  );
};

/**
 * A handle the graph knows twice is not a handle the graph does not know — even
 * when one of the nodes it names is one the index holds no span for.
 */
const scenario_an_ambiguous_handle_the_graph_holds_no_span_for = async () => {
  const nodes: ISamchonGraphNode[] = [
    fn("src/a.ts#twin:function", "twin", 1),
    {
      id: "src/b.ts#twin:function",
      kind: "function",
      language: "typescript",
      name: "twin",
      file: "src/b.ts",
      external: false,
      exported: true,
    },
  ];
  const app = new SamchonGraphApplication(
    SamchonGraphMemory.from(dumpOf("/spanless", nodes, [])),
  );
  const details = (
    await app.inspect_code_graph({
      question: "what is twin",
      draft: { reason: "Details.", type: "details" },
      review: "Details.",
      request: { type: "details", handles: ["twin"] },
    })
  ).result as ISamchonGraphDetails;
  TestValidator.equals(
    "both readings come back, and the one with no span still names itself",
    details.ambiguous?.[0]?.candidates.map((candidate) => candidate.line),
    [1, undefined],
  );
};

/**
 * A tour whose seed's neighbour edge carries no evidence cannot cite a span it
 * does not hold, so it does not; a seed whose span records no end line is still
 * an entrypoint; a flow that reaches nothing but shared utilities is a flow the
 * tour has already told; and a test that sits beside its subject is the one a
 * newcomer reads.
 */
const scenario_a_tour_over_a_graph_that_is_missing_its_evidence = async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-half-"));
  write(root, "src/order/create.ts", [
    "/**",
    " * Creates an order, which is the flow this whole tour is about.",
    " */",
    "export function createOrder(): void {}",
  ]);
  write(root, "src/order/create.test.ts", ["export function itCreates(): void {}"]);
  write(root, "test/e2e.test.ts", ["export function itAlsoCreates(): void {}"]);

  const nodes: ISamchonGraphNode[] = [
    {
      id: "src/order/create.ts#createOrder:function",
      kind: "function",
      language: "typescript",
      name: "createOrder",
      file: "src/order/create.ts",
      external: false,
      exported: true,
      // A span with no end line: the tour still cites where it starts.
      evidence: { file: "src/order/create.ts", startLine: 4 },
    },
    fn("src/order/create.ts#persist:function", "persist", 6),
    fn("src/order/create.test.ts#itCreates:function", "itCreates", 1),
    fn("test/e2e.test.ts#itAlsoCreates:function", "itAlsoCreates", 1),
  ];
  const edges = [
    // A dependency edge the index carries no evidence for: an anchor cannot be
    // cited from a span the graph does not hold.
    {
      from: "src/order/create.ts#createOrder:function",
      to: "src/order/create.ts#persist:function",
      kind: "calls" as const,
    },
    // Two suites cover the same subject. The one beside the code is the one a
    // newcomer reads, so it comes first.
    tests("test/e2e.test.ts#itAlsoCreates:function", "src/order/create.ts#createOrder:function"),
    tests("src/order/create.test.ts#itCreates:function", "src/order/create.ts#createOrder:function"),
    exportsOf("src/order/create.ts", "src/order/create.ts#createOrder:function"),
    exportsOf("src/index.ts", "src/order/create.ts#createOrder:function"),
    exportsOf("src/order/create.ts", "src/order/create.ts#persist:function"),
  ];
  const app = new SamchonGraphApplication(
    SamchonGraphMemory.from(dumpOf(root, nodes, edges)),
  );
  const tour = (
    await app.inspect_code_graph({
      question: "how does an order get created",
      draft: { reason: "Orientation.", type: "tour" },
      review: "Tour.",
      request: { type: "tour", reinterpretations: [] },
    })
  ).result as ISamchonGraphTour;

  const seed = tour.entrypoints.find((node) => node.name === "createOrder");
  TestValidator.predicate(
    "a seed whose span records no end line is still an entrypoint",
    seed !== undefined && seed.sourceSpan?.endLine === undefined,
  );
  // A name and an edge say what calls what; the doc says why, which is what a
  // tour is asked for.
  TestValidator.equals(
    "and the tour carries what the project says the symbol is for",
    seed?.doc,
    "Creates an order, which is the flow this whole tour is about.",
  );
  TestValidator.predicate(
    "an edge the index holds no span for is cited nowhere",
    tour.nearby.every((anchor) => anchor.name !== "persist"),
  );
  const covered = tour.tests.map((anchor) => anchor.file);
  TestValidator.predicate(
    "the test beside the subject ranks ahead of the one that is not",
    covered.indexOf("src/order/create.test.ts") <= covered.indexOf("test/e2e.test.ts"),
  );
};

/**
 * A junction is the symbol to look at *next*, so a dependency's declaration is
 * not one: the graph keeps it as a named endpoint and does not walk into it.
 */
const scenario_a_junction_the_graph_will_not_hand_back = async () => {
  const nodes: ISamchonGraphNode[] = [
    fn("src/a.ts#left:function", "left", 1),
    fn("src/b.ts#right:function", "right", 1),
    {
      id: "external:typescript:lodash",
      kind: "external_symbol",
      language: "typescript",
      name: "lodash",
      file: "",
      external: true,
    },
    fn("src/state.ts#state:variable", "state", 1),
    fn("src/hook.ts#hook:function", "hook", 1),
  ];
  const edges = [
    // Both ends call into the same dependency. It is not a symbol to look at
    // next, because the graph will not walk into it.
    calls("src/a.ts#left:function", "external:typescript:lodash"),
    calls("src/b.ts#right:function", "external:typescript:lodash"),
    // Both ends touch the same state — and one of the two edges carries no
    // evidence, which the junction reports honestly rather than inventing.
    accesses("src/a.ts#left:function", "src/state.ts#state:variable"),
    {
      from: "src/b.ts#right:function",
      to: "src/state.ts#state:variable",
      kind: "accesses" as const,
    },
    // A symbol that reaches *into* both ends is a seam too, and this one is
    // recorded with no span at all.
    {
      from: "src/hook.ts#hook:function",
      to: "src/a.ts#left:function",
      kind: "calls" as const,
    },
    {
      from: "src/hook.ts#hook:function",
      to: "src/b.ts#right:function",
      kind: "calls" as const,
    },
  ];
  const app = new SamchonGraphApplication(
    SamchonGraphMemory.from(dumpOf("/deps", nodes, edges)),
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
  TestValidator.predicate("the state both ends touch is the seam", named.includes("state"));
  TestValidator.equals(
    "a dependency's declaration is not a symbol to look at next",
    named.filter((name) => name === "lodash"),
    [],
  );
  TestValidator.equals(
    "and a junction edge the graph holds no span for claims none",
    trace.junctions?.find((junction) => junction.name === "state")?.fromTarget
      .evidence,
    undefined,
  );
  // A junction is what both ends *touch*, in either direction: a symbol that
  // reaches into both of them stands between them just as surely as one they both
  // reach into.
  const hook = trace.junctions?.find((junction) => junction.name === "hook");
  TestValidator.equals(
    "a symbol that reaches into both ends is a seam too",
    hook?.fromStart.outgoing,
    false,
  );
  TestValidator.equals(
    "and it claims no span it does not have",
    hook?.fromStart.evidence,
    undefined,
  );
};

/**
 * A `dispatches` hop is cited at the implementation — and when the index holds
 * no span for the `overrides` edge it came from, the hop carries none rather
 * than inventing one.
 */
const scenario_a_dispatch_the_index_carries_no_span_for = async () => {
  const nodes: ISamchonGraphNode[] = [
    method("src/base.ts#Base.execute:method", "execute", "Base.execute", 1),
    method("src/impl.ts#Impl.execute:method", "execute", "Impl.execute", 1),
    fn("src/impl.ts#work:function", "work", 5),
    fn("src/run.ts#run:function", "run", 1),
  ];
  const edges = [
    calls("src/run.ts#run:function", "src/base.ts#Base.execute:method"),
    // No evidence on the override: the hop it produces claims none either.
    {
      from: "src/impl.ts#Impl.execute:method",
      to: "src/base.ts#Base.execute:method",
      kind: "overrides" as const,
    },
    calls("src/impl.ts#Impl.execute:method", "src/impl.ts#work:function"),
  ];
  const app = new SamchonGraphApplication(
    SamchonGraphMemory.from(dumpOf("/dispatch", nodes, edges)),
  );
  const trace = (
    await app.inspect_code_graph({
      question: "what does run execute",
      draft: { reason: "One forward trace.", type: "trace" },
      review: "Trace.",
      request: {
        type: "trace",
        from: "run",
        direction: "forward",
        focus: "execution",
        maxDepth: 4,
      },
    })
  ).result as ISamchonGraphTrace;
  const dispatch = trace.hops.find((hop) => hop.kind === "dispatches");
  TestValidator.equals(
    "the walk still dispatches into the code that runs",
    dispatch?.to,
    "src/impl.ts#Impl.execute:method",
  );
  TestValidator.equals(
    "and cites no span, because the index holds none",
    dispatch?.evidence,
    undefined,
  );
};

/**
 * The neighbour lists a `details` call is capped by, over a graph that half-holds
 * its neighbours: a dangling edge, a dependency's declaration, a bundled `.d.ts`,
 * and a relation the index recorded twice.
 */
const scenario_details_over_neighbours_the_graph_half_holds = async () => {
  const nodes: ISamchonGraphNode[] = [
    method("src/api.ts#Api.run:method", "run", "Api.run", 1),
    // An implementor with no owner-qualified name of its own.
    {
      id: "src/impl.ts#Impl:class",
      kind: "class",
      language: "typescript",
      name: "Impl",
      file: "src/impl.ts",
      external: false,
      exported: true,
      evidence: { file: "src/impl.ts", startLine: 1, endLine: 4 },
    },
    // An implementor that is a dependency's declaration.
    {
      id: "external:typescript:Vendor",
      kind: "external_symbol",
      language: "typescript",
      name: "Vendor",
      file: "",
      external: true,
    },
    // An implementor declared in a bundled type declaration: it ranks behind
    // every authored one.
    {
      id: "bundled://lib.d.ts#Ambient:class",
      kind: "class",
      language: "typescript",
      name: "Ambient",
      file: "bundled://lib.d.ts",
      external: false,
      evidence: { file: "bundled://lib.d.ts", startLine: 1 },
    },
  ];
  const edges = [
    implementsOf("src/impl.ts#Impl:class", "src/api.ts#Api.run:method", 2),
    // The same relation, recorded twice: a neighbour is named once.
    implementsOf("src/impl.ts#Impl:class", "src/api.ts#Api.run:method", 2),
    implementsOf("external:typescript:Vendor", "src/api.ts#Api.run:method", 3),
    implementsOf("bundled://lib.d.ts#Ambient:class", "src/api.ts#Api.run:method", 1),
    // A dangling edge: the index names a node the dump does not hold.
    implementsOf("src/gone.ts#Ghost:class", "src/api.ts#Api.run:method", 1),
  ];
  const app = new SamchonGraphApplication(
    SamchonGraphMemory.from(dumpOf("/half", nodes, edges)),
  );
  const details = (
    await app.inspect_code_graph({
      question: "what implements Api.run",
      draft: { reason: "Details answers implementedBy.", type: "details" },
      review: "Details.",
      request: { type: "details", handles: ["Api.run"], dependencyLimit: 4 },
    })
  ).result as ISamchonGraphDetails;
  const implementedBy = details.nodes[0]?.implementedBy ?? [];

  TestValidator.equals(
    "a neighbour the index recorded twice is named once",
    implementedBy.filter((ref) => ref.name === "Impl").length,
    1,
  );
  // A dependency's declaration and a bundled type declaration are both
  // dependency-boundary leaves: the graph keeps them as named endpoints and does
  // not walk into them, so an ordinary call never sees either.
  TestValidator.equals(
    "the dependency boundary stays out of the answer",
    implementedBy
      .filter((ref) => ref.name === "Vendor" || ref.name === "Ambient")
      .map((ref) => ref.name),
    [],
  );

  // A question that *is* about the external type boundary asks for it, and then
  // the authored declaration still ranks ahead of the bundled one.
  const external = (
    await app.inspect_code_graph({
      question: "what implements Api.run, including the type boundary",
      draft: { reason: "The boundary is the question.", type: "details" },
      review: "Details with external.",
      request: {
        type: "details",
        handles: ["Api.run"],
        dependencyLimit: 4,
        includeExternal: true,
      },
    })
  ).result as ISamchonGraphDetails;
  const withBoundary = external.nodes[0]?.implementedBy ?? [];
  TestValidator.predicate(
    "an authored declaration ranks ahead of a bundled one",
    withBoundary.findIndex((ref) => ref.name === "Impl") <
      withBoundary.findIndex((ref) => ref.name === "Ambient"),
  );
};

/**
 * `renderer.render` is a file stem and the symbol it declares — how a model
 * disambiguates a common name from what the graph just showed it. Two files with
 * the same stem answer to it, and the candidates come back ranked, with a
 * dependency's declaration last.
 */
const scenario_a_file_qualified_handle_two_files_answer_to = async () => {
  const nodes: ISamchonGraphNode[] = [
    fn("src/dom/render.ts#draw:function", "draw", 1),
    fn("src/svg/render.ts#draw:function", "draw", 1),
    {
      id: "external:typescript:draw",
      kind: "external_symbol",
      language: "typescript",
      name: "draw",
      file: "",
      external: true,
    },
  ];
  const app = new SamchonGraphApplication(
    SamchonGraphMemory.from(dumpOf("/stems", nodes, [])),
  );
  const byName = (
    await app.inspect_code_graph({
      question: "trace draw",
      draft: { reason: "One trace.", type: "trace" },
      review: "Trace.",
      request: { type: "trace", from: "draw", includeExternal: true },
    })
  ).result as ISamchonGraphTrace;
  TestValidator.equals(
    "a dependency's declaration is the last reading of an ambiguous name",
    byName.candidates?.[byName.candidates.length - 1]?.name,
    "draw",
  );
  TestValidator.equals(
    "and it is a dependency's",
    byName.candidates?.[byName.candidates.length - 1]?.id,
    "external:typescript:draw",
  );

  const byStem = (
    await app.inspect_code_graph({
      question: "trace render.draw",
      draft: { reason: "One trace.", type: "trace" },
      review: "Trace.",
      request: { type: "trace", from: "render.draw" },
    })
  ).result as ISamchonGraphTrace;
  TestValidator.equals(
    "two files with the same stem both answer to a file-qualified handle",
    byStem.candidates?.length,
    2,
  );
};

/**
 * A span the source has moved out from under names a line the file does not
 * have, and there is nothing above a line that does not exist. Reading the last
 * line of the file instead would be the index answering from a fact it no longer
 * holds.
 */
const scenario_a_doc_whose_span_the_source_moved_out_from_under = async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-stale-"));
  write(root, "src/short.ts", [
    "/** Still here. */",
    "export function present(): void {}",
  ]);
  const app = new SamchonGraphApplication(
    SamchonGraphMemory.from(
      dumpOf(
        root,
        [
          {
            id: "src/short.ts#present:function",
            kind: "function",
            language: "typescript",
            name: "present",
            file: "src/short.ts",
            external: false,
            exported: true,
            // A span past the end of a two-line file.
            evidence: { file: "src/short.ts", startLine: 900 },
          },
        ],
        [],
      ),
    ),
  );
  const details = (
    await app.inspect_code_graph({
      question: "what does present do",
      draft: { reason: "Details.", type: "details" },
      review: "Details.",
      request: { type: "details", handles: ["present"] },
    })
  ).result as ISamchonGraphDetails;
  TestValidator.equals(
    "a span the file cannot hold reads no doc above it",
    details.nodes[0]?.doc,
    undefined,
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
  evidence: {
    file: id.slice(0, id.indexOf("#")),
    startLine: line,
    endLine: line + 2,
  },
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
  evidence: {
    file: id.slice(0, id.indexOf("#")),
    startLine: line,
    endLine: line + 2,
  },
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

const tests = (from: string, to: string) => ({
  from,
  to,
  kind: "tests" as const,
  evidence: { startLine: 1 },
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
