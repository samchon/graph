import { TestValidator } from "@nestia/e2e";
import { SamchonGraphApplication } from "@samchon/graph";
import type { SamchonGraphMemory } from "@samchon/graph";

/**
 * An escape performs no graph work at all.
 *
 * `escape` exists to say "this is not a graph question, I am leaving". A
 * developer who opens an agent on a cold checkout and asks something the graph
 * cannot answer must not pay for an index they said they did not need — and a
 * project the index cannot even build must not turn that answer into a failure.
 *
 * The graph source is only ever called for a request that actually reads the
 * graph, so a source that throws proves the escape branch returned before it: if
 * the escape had loaded the graph, this call would fail instead of answering.
 */
export const test_escape_does_not_load_the_graph = async () => {
  let loads = 0;
  const app = new SamchonGraphApplication((): SamchonGraphMemory => {
    loads++;
    throw new Error("the graph must not be indexed for an escape");
  });

  const output = await app.inspect_code_graph({
    question: "Where is the deploy script configured?",
    draft: {
      reason: "The next evidence is outside the indexed graph.",
      type: "escape",
    },
    review: "Confirmed: skip graph work and return escape.",
    request: {
      type: "escape",
      reason: "A package script is not a symbol the graph holds.",
      nextStep: "Read package.json.",
    },
  });

  TestValidator.equals("the escape answers", output.result.type, "escape");
  TestValidator.equals(
    "and it never touched the index",
    loads,
    0,
  );
  TestValidator.equals(
    "an escape leaves the graph, so it names no further request",
    output.next.request,
    undefined,
  );

  // Every other request does load the graph — which is what makes the assertion
  // above mean something.
  await TestValidator.error("a real request does index the project", async () => {
    await app.inspect_code_graph({
      question: "Where is OrderService declared?",
      draft: { reason: "A named symbol.", type: "lookup" },
      review: "Lookup.",
      request: { type: "lookup", query: "OrderService" },
    });
  });
  TestValidator.equals("the graph was asked for exactly once", loads, 1);
};
