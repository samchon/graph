import { TestValidator } from "@nestia/e2e";
import { SamchonGraphApplication, SamchonGraphMemory } from "@samchon/graph";
import type {
  ISamchonGraphDump,
  ISamchonGraphNode,
  ISamchonGraphTour,
  ISamchonGraphTrace,
} from "@samchon/graph";

/**
 * A `constructor` is a method, and a `field` is a property.
 *
 * The reference has a TypeScript checker, which reports both under those names.
 * A language server does not: it reports `SymbolKind.Constructor` and
 * `SymbolKind.Field`, and this graph carries them, because a Java class really
 * does declare a constructor and a Kotlin class really does declare a field.
 *
 * Carrying the kinds and then not spending them is the worst of both: the tour's
 * seed kinds, the flow's start kinds, and the trace's endpoint ranking were all
 * copied from a vocabulary that has no such words, so every constructor and every
 * field in every language that reports them could never be a seed, never start a
 * flow, and always ranked in the unknown-kind bucket. That is not parity with the
 * reference — the reference has no such declarations to leave out. It is a whole
 * vocabulary of declarations that could not be toured.
 */
export const test_the_tour_reads_every_vocabulary_the_languages_give_it =
  async () => {
    const app = new SamchonGraphApplication(SamchonGraphMemory.from(dump()));

    const tour = (
      await app.inspect_code_graph({
        question: "how does a request reach the repository",
        draft: { reason: "Orientation.", type: "tour" },
        review: "Tour.",
        request: { type: "tour", reinterpretations: [] },
      })
    ).result as ISamchonGraphTour;

    TestValidator.predicate(
      "a constructor is an entrypoint the tour can open on",
      tour.entrypoints.some((node) => node.name === "OrderService.constructor"),
    );
    TestValidator.predicate(
      "and a flow can start from it",
      tour.primaryFlow.some(
        (flow) => flow.start.name === "OrderService.constructor",
      ),
    );
    // A data field runs nothing, exactly like a data property, so it is not a
    // seed. A field that *does* run something is — which is the same rule the
    // reference applies to a property, under the name its own checker uses.
    TestValidator.predicate(
      "a field that runs something is an entrypoint",
      tour.entrypoints.some((node) => node.name === "OrderService.handler"),
    );
    TestValidator.equals(
      "a field that runs nothing is not",
      tour.entrypoints.filter((node) => node.name === "OrderService.name"),
      [],
    );

    // And a trace ranks them where their counterparts rank: a constructor with
    // the methods, a field with the properties — not in the unknown bucket behind
    // both.
    const trace = (
      await app.inspect_code_graph({
        question: "what calls the repository",
        draft: { reason: "Callers.", type: "trace" },
        review: "Trace.",
        request: { type: "trace", from: "OrderRepository.save", direction: "reverse" },
      })
    ).result as ISamchonGraphTrace;
    const reached = trace.reached.map((node) => node.name);
    TestValidator.predicate(
      "a constructor ranks with the methods, not behind the types",
      reached.indexOf("OrderService.constructor") < reached.indexOf("IOrder"),
    );
  };

/** A class in the shape a language server reports one: constructor, field, method. */
const dump = (): ISamchonGraphDump => ({
  project: "/java",
  languages: ["java"],
  indexer: "lsp",
  nodes: [
    node("src/OrderService.java#OrderService:class", "class", "OrderService", undefined, 1),
    node(
      "src/OrderService.java#OrderService.constructor:constructor",
      "constructor",
      "constructor",
      "OrderService.constructor",
      3,
    ),
    // A field that holds a callable: it runs something, so it is a seed.
    node(
      "src/OrderService.java#OrderService.handler:field",
      "field",
      "handler",
      "OrderService.handler",
      7,
    ),
    // A data field: it runs nothing, so it is not.
    node(
      "src/OrderService.java#OrderService.name:field",
      "field",
      "name",
      "OrderService.name",
      11,
    ),
    node("src/OrderRepository.java#OrderRepository.save:method", "method", "save", "OrderRepository.save", 1),
    node("src/IOrder.java#IOrder:interface", "interface", "IOrder", undefined, 1),
  ],
  edges: [
    exportsOf("src/OrderService.java", "src/OrderService.java#OrderService:class"),
    exportsOf("src/index.java", "src/OrderService.java#OrderService:class"),
    exportsOf("src/OrderRepository.java", "src/OrderRepository.java#OrderRepository.save:method"),
    exportsOf("src/IOrder.java", "src/IOrder.java#IOrder:interface"),
    contains("src/OrderService.java#OrderService:class", "src/OrderService.java#OrderService.constructor:constructor"),
    contains("src/OrderService.java#OrderService:class", "src/OrderService.java#OrderService.handler:field"),
    contains("src/OrderService.java#OrderService:class", "src/OrderService.java#OrderService.name:field"),
    calls(
      "src/OrderService.java#OrderService.constructor:constructor",
      "src/OrderRepository.java#OrderRepository.save:method",
    ),
    calls(
      "src/OrderService.java#OrderService.handler:field",
      "src/OrderRepository.java#OrderRepository.save:method",
    ),
    typeRef("src/IOrder.java#IOrder:interface", "src/OrderRepository.java#OrderRepository.save:method"),
  ],
});

const node = (
  id: string,
  kind: string,
  name: string,
  qualifiedName: string | undefined,
  line: number,
): ISamchonGraphNode => ({
  id,
  kind: kind as "method",
  language: "java",
  name,
  ...(qualifiedName !== undefined ? { qualifiedName } : {}),
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

const typeRef = (from: string, to: string) => ({
  from,
  to,
  kind: "type_ref" as const,
  evidence: { startLine: 2 },
});

const contains = (from: string, to: string) => ({
  from,
  to,
  kind: "contains" as const,
});

const exportsOf = (from: string, to: string) => ({
  from,
  to,
  kind: "exports" as const,
});
