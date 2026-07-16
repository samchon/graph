import { TestValidator } from "@nestia/e2e";
import {
  SamchonGraphApplication,
  SamchonGraphMemory,
  type GraphNodeKind,
  type ISamchonGraphDetails,
  type ISamchonGraphDump,
  type ISamchonGraphTour,
  type ISamchonGraphTrace,
} from "@samchon/graph";

/**
 * A strict ttsc dump deliberately leaves two resident facts to its canonical
 * memory layer: class-owned variables are properties, and a type heritage edge
 * implies the matching member relation. The generalized memory must restore
 * those facts without mutating or duplicating the compiler dump.
 */
export const test_ttsc_memory_synthesizes_properties_and_member_relations =
  async () => {
    const dump = ttscStyleDump();
    const graph = SamchonGraphMemory.from(dump);

    TestValidator.equals(
      "a class-owned raw variable becomes a resident property",
      graph.node(WORKER_LABEL)?.kind,
      "property",
    );
    TestValidator.equals(
      "an interface-owned raw variable becomes a resident property",
      graph.node(HANDLER_LABEL)?.kind,
      "property",
    );
    TestValidator.equals(
      "a top-level variable remains a variable",
      graph.node(VERSION)?.kind,
      "variable",
    );
    TestValidator.predicate(
      "property refinement preserves ttsc's stable raw id",
      graph.node(WORKER_LABEL)?.id.endsWith(":variable") === true,
    );
    TestValidator.predicate(
      "resident synthesis does not mutate the caller's compiler dump",
      dump.nodes.find((node) => node.id === WORKER_LABEL)?.kind === "variable" &&
        dump.nodes.find((node) => node.id === HANDLER_LABEL)?.kind ===
          "variable",
    );

    const relations = graph.edges.filter((edge) =>
      edge.kind === "implements" || edge.kind === "overrides",
    );
    TestValidator.predicate(
      "type implementation derives the matching method relation",
      relations.some(
        (edge) =>
          edge.kind === "implements" &&
          edge.from === WORKER_HANDLE &&
          edge.to === HANDLER_HANDLE &&
          edge.evidence?.file === "src/worker.ts" &&
          edge.evidence.startLine === 12,
      ),
    );
    TestValidator.predicate(
      "refined properties participate in member implementation",
      relations.some(
        (edge) =>
          edge.kind === "implements" &&
          edge.from === WORKER_LABEL &&
          edge.to === HANDLER_LABEL,
      ),
    );
    TestValidator.predicate(
      "a language-server field participates in member overriding",
      relations.some(
        (edge) =>
          edge.kind === "overrides" &&
          edge.from === WORKER_SLOT &&
          edge.to === BASE_SLOT,
      ),
    );
    TestValidator.equals(
      "an already supplied member relation is not duplicated",
      relations.filter(
        (edge) => edge.from === WORKER_RUN && edge.to === BASE_RUN,
      ).length,
      1,
    );
    TestValidator.predicate(
      "constructors are not inherited member implementations",
      relations.every(
        (edge) =>
          edge.from !== WORKER_CONSTRUCTOR || edge.to !== BASE_CONSTRUCTOR,
      ),
    );

    const app = new SamchonGraphApplication(graph);
    const details = await app.inspect_code_graph({
      question: "What implements Handler.handle?",
      draft: { reason: "Details names implementations.", type: "details" },
      review: "Inspect the named interface member.",
      request: {
        type: "details",
        handles: [HANDLER_HANDLE],
        neighbors: true,
      },
    });
    TestValidator.equals(
      "details observes the synthesized method relation",
      (details.result as ISamchonGraphDetails).nodes[0]?.implementedBy?.map(
        (node) => node.id,
      ),
      [WORKER_HANDLE],
    );

    const trace = await app.inspect_code_graph({
      question: "What runs when start invokes the handler?",
      draft: { reason: "Trace follows runtime dispatch.", type: "trace" },
      review: "Follow the concrete implementation.",
      request: {
        type: "trace",
        from: START,
        direction: "forward",
        focus: "execution",
        maxDepth: 5,
      },
    });
    const traced = trace.result as ISamchonGraphTrace;
    TestValidator.predicate(
      "trace dispatches through the synthesized implementation edge",
      traced.hops.some(
        (hop) =>
          hop.kind === "dispatches" &&
          hop.from === HANDLER_HANDLE &&
          hop.to === WORKER_HANDLE,
      ) && traced.reached.some((node) => node.id === WORK),
    );

    const tour = await app.inspect_code_graph({
      question: "Show the start handler flow.",
      draft: { reason: "Tour summarizes the runtime path.", type: "tour" },
      review: "Use the named entrypoint.",
      request: { type: "tour", reinterpretations: ["start"], limit: 1 },
    });
    const toured = tour.result as ISamchonGraphTour;
    TestValidator.predicate(
      "tour centrality and flow see the synthesized dispatch path",
      toured.primaryFlow.some((flow) =>
        flow.reached.some((node) => node.id === WORKER_HANDLE),
      ),
    );
  };

const HANDLER = "src/api.ts#Handler:interface";
const HANDLER_HANDLE = "src/api.ts#Handler.handle:method";
const HANDLER_LABEL = "src/api.ts#Handler.label:variable";
const BASE = "src/base.ts#Base:class";
const BASE_RUN = "src/base.ts#Base.run:method";
const BASE_SLOT = "src/base.ts#Base.slot:field";
const BASE_CONSTRUCTOR = "src/base.ts#Base.constructor:constructor";
const WORKER = "src/worker.ts#Worker:class";
const WORKER_HANDLE = "src/worker.ts#Worker.handle:method";
const WORKER_LABEL = "src/worker.ts#Worker.label:variable";
const WORKER_RUN = "src/worker.ts#Worker.run:method";
const WORKER_SLOT = "src/worker.ts#Worker.slot:field";
const WORKER_CONSTRUCTOR = "src/worker.ts#Worker.constructor:constructor";
const WORK = "src/work.ts#work:function";
const START = "src/start.ts#start:function";
const VERSION = "src/version.ts#version:variable";

const ttscStyleDump = (): ISamchonGraphDump => ({
  project: "/ttsc-memory",
  languages: ["typescript"],
  indexer: "lsp",
  nodes: [
    node(HANDLER, "interface", "Handler", undefined, 1, true),
    node(HANDLER_HANDLE, "method", "handle", "Handler.handle", 2),
    node(HANDLER_LABEL, "variable", "label", "Handler.label", 3),
    node(BASE, "class", "Base", undefined, 1, true),
    node(BASE_RUN, "method", "run", "Base.run", 2),
    node(BASE_SLOT, "field", "slot", "Base.slot", 3),
    node(
      BASE_CONSTRUCTOR,
      "constructor",
      "constructor",
      "Base.constructor",
      4,
    ),
    node(WORKER, "class", "Worker", undefined, 8, true),
    {
      ...node(
        WORKER_HANDLE,
        "method",
        "handle",
        "Worker.handle",
        10,
      ),
      implementation: { startLine: 12, endLine: 14 },
    },
    node(WORKER_LABEL, "variable", "label", "Worker.label", 15),
    node(WORKER_RUN, "method", "run", "Worker.run", 16),
    node(WORKER_SLOT, "field", "slot", "Worker.slot", 17),
    node(
      WORKER_CONSTRUCTOR,
      "constructor",
      "constructor",
      "Worker.constructor",
      18,
    ),
    node(WORK, "function", "work", undefined, 1),
    node(START, "function", "start", undefined, 1, true),
    node(VERSION, "variable", "version", undefined, 1),
  ],
  edges: [
    { from: "src/index.ts", to: START, kind: "exports" },
    { from: "src/index.ts", to: WORKER, kind: "exports" },
    { from: WORKER, to: HANDLER, kind: "implements" },
    { from: WORKER, to: BASE, kind: "extends" },
    {
      from: WORKER_RUN,
      to: BASE_RUN,
      kind: "overrides",
      evidence: { startLine: 16 },
    },
    {
      from: START,
      to: HANDLER_HANDLE,
      kind: "calls",
      evidence: { startLine: 2 },
    },
    {
      from: WORKER_HANDLE,
      to: WORK,
      kind: "calls",
      evidence: { startLine: 13 },
    },
  ],
});

const node = (
  id: string,
  kind: GraphNodeKind,
  name: string,
  qualifiedName: string | undefined,
  line: number,
  exported = false,
): ISamchonGraphDump.INode => ({
  id,
  kind,
  language: "typescript",
  name,
  ...(qualifiedName === undefined ? {} : { qualifiedName }),
  file: id.slice(0, id.indexOf("#")),
  external: false,
  ...(exported ? { exported: true } : {}),
  evidence: { startLine: line, endLine: line },
});
