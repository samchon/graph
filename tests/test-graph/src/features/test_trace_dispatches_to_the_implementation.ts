import { TestValidator } from "@nestia/e2e";
import { SamchonGraphApplication, SamchonGraphMemory } from "@samchon/graph";
import type { ISamchonGraphDump, ISamchonGraphTrace } from "@samchon/graph";

/**
 * A forward trace continues into the implementation a virtual call dispatches
 * to, instead of stopping at the declaration the checker resolved.
 *
 * A call that lands on an abstract method or an interface member reaches a
 * declaration with no body, and the code that runs hangs off it as an incoming
 * `overrides`/`implements` edge — an edge no forward walk crosses. A framework's
 * whole request pipeline can sit behind one, so the graph reported that a
 * request reaches an abstract declaration and stops, and the guard it actually
 * runs was reachable from nothing but its own unit test.
 *
 * The dead-end declaration yields a `dispatches` hop to every implementation
 * that has a body, cited at the implementation — which is the fact: the call site
 * named the base, and the runtime lands in the override.
 */
export const test_trace_dispatches_to_the_implementation = async () => {
  const dump: ISamchonGraphDump = {
    project: "/pipeline",
    languages: ["typescript"],
    indexer: "static",
    nodes: [
      declaration("src/app.ts#transform:function", "function", "transform", 1),
      declaration("src/app.ts#persist:function", "function", "persist", 2),
      declaration("src/app.ts#Pipeline:class", "class", "Pipeline", 4),
      // The abstract declaration: no body, so nothing outgoing that executes.
      declaration("src/app.ts#Pipeline.execute:method", "method", "execute", 5, "Pipeline.execute"),
      declaration("src/app.ts#Pipeline.start:method", "method", "start", 7, "Pipeline.start"),
      declaration("src/app.ts#TransformPipeline:class", "class", "TransformPipeline", 12),
      declaration("src/app.ts#TransformPipeline.execute:method", "method", "execute", 13, "TransformPipeline.execute"),
      declaration("src/app.ts#PersistPipeline:class", "class", "PersistPipeline", 18),
      declaration("src/app.ts#PersistPipeline.execute:method", "method", "execute", 19, "PersistPipeline.execute"),
      declaration("src/app.ts#Runner:class", "class", "Runner", 24),
      declaration("src/app.ts#Runner.run:method", "method", "run", 27, "Runner.run"),
    ],
    edges: [
      // Runner.run -> Pipeline.start -> Pipeline.execute (abstract; dead end).
      edge("src/app.ts#Runner.run:method", "src/app.ts#Pipeline.start:method", "calls"),
      edge("src/app.ts#Pipeline.start:method", "src/app.ts#Pipeline.execute:method", "calls"),
      // The implementations, and the work each one does.
      edge("src/app.ts#TransformPipeline.execute:method", "src/app.ts#Pipeline.execute:method", "overrides"),
      edge("src/app.ts#PersistPipeline.execute:method", "src/app.ts#Pipeline.execute:method", "overrides"),
      edge("src/app.ts#TransformPipeline.execute:method", "src/app.ts#transform:function", "calls"),
      edge("src/app.ts#PersistPipeline.execute:method", "src/app.ts#persist:function", "calls"),
    ],
  };
  const app = new SamchonGraphApplication(SamchonGraphMemory.from(dump));
  const output = await app.inspect_code_graph({
    question: "What does a run actually execute?",
    draft: { reason: "One forward trace walks the runtime chain.", type: "trace" },
    review: "Trace is the smallest request that answers it.",
    request: {
      type: "trace",
      from: "Runner.run",
      direction: "forward",
      focus: "execution",
      maxDepth: 6,
      maxNodes: 16,
    },
  });
  const trace = output.result as ISamchonGraphTrace;
  const reached = trace.reached.map((node) => node.name);
  const dispatched = trace.hops
    .filter((hop) => hop.kind === "dispatches")
    .map((hop) => trace.reached.find((node) => node.id === hop.to)?.name);

  TestValidator.predicate(
    "the trace reaches the base method",
    reached.includes("Pipeline.start"),
  );
  TestValidator.predicate(
    "the abstract method dispatches to both implementations",
    dispatched.includes("TransformPipeline.execute") &&
      dispatched.includes("PersistPipeline.execute"),
  );
  TestValidator.predicate(
    "the work behind each implementation is reached",
    reached.includes("transform") && reached.includes("persist"),
  );

  // A `types` focus follows what a symbol is declared against, not what runs, so
  // it never dispatches: the implementation is the runtime's answer, not the
  // type system's.
  const typed = await app.inspect_code_graph({
    question: "What is a run declared against?",
    draft: { reason: "Type relations only.", type: "trace" },
    review: "Types focus.",
    request: {
      type: "trace",
      from: "Pipeline.start",
      direction: "forward",
      focus: "types",
      maxDepth: 4,
    },
  });
  TestValidator.equals(
    "a types focus never dispatches",
    (typed.result as ISamchonGraphTrace).hops.filter(
      (hop) => hop.kind === "dispatches",
    ),
    [],
  );

  await scenario_a_declaration_everything_implements_stays_a_leaf();
};

/**
 * A declaration the codebase implements everywhere is not a step in one flow.
 * A disposable, a listener, a lifecycle hook carries dozens of implementors, and
 * naming them all is a dump of the codebase rather than an answer — so past the
 * hub cut the declaration stays a leaf, and `details` answers `implementedBy`
 * for the caller that actually wants the list.
 */
const scenario_a_declaration_everything_implements_stays_a_leaf = async () => {
  const implementors = Array.from({ length: 12 }, (_, index) => index);
  const dump: ISamchonGraphDump = {
    project: "/polymorphic",
    languages: ["typescript"],
    indexer: "static",
    nodes: [
      declaration("src/d.ts#caller:function", "function", "caller", 1),
      declaration("src/d.ts#Disposable.dispose:method", "method", "dispose", 2, "Disposable.dispose"),
      ...implementors.flatMap((index) => [
        declaration(`src/d.ts#Impl${index}.dispose:method`, "method", "dispose", 10 + index, `Impl${index}.dispose`),
        declaration(`src/d.ts#work${index}:function`, "function", `work${index}`, 40 + index),
      ]),
    ],
    edges: [
      edge("src/d.ts#caller:function", "src/d.ts#Disposable.dispose:method", "calls"),
      ...implementors.flatMap((index) => [
        edge(`src/d.ts#Impl${index}.dispose:method`, "src/d.ts#Disposable.dispose:method", "implements"),
        edge(`src/d.ts#Impl${index}.dispose:method`, `src/d.ts#work${index}:function`, "calls"),
      ]),
    ],
  };
  const app = new SamchonGraphApplication(SamchonGraphMemory.from(dump));
  const output = await app.inspect_code_graph({
    question: "What does the caller dispose?",
    draft: { reason: "One forward trace.", type: "trace" },
    review: "Trace it.",
    request: {
      type: "trace",
      from: "caller",
      direction: "forward",
      focus: "execution",
      maxDepth: 6,
      maxNodes: 32,
    },
  });
  const trace = output.result as ISamchonGraphTrace;
  TestValidator.equals(
    "a 12-way declaration refuses to dump its implementors into the flow",
    trace.hops.filter((hop) => hop.kind === "dispatches"),
    [],
  );
  TestValidator.predicate(
    "the declaration itself is still reached",
    trace.reached.some((node) => node.name === "Disposable.dispose"),
  );
};

const declaration = (
  id: string,
  kind: string,
  name: string,
  line: number,
  qualifiedName?: string,
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
  evidence: { startLine: 1 },
});
