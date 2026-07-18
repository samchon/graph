import { TestValidator } from "@nestia/e2e";
import {
  ISamchonGraphDump,
  SamchonGraphApplication,
  SamchonGraphMemory,
} from "@samchon/graph";

export const test_tour_follows_a_recursive_definition_without_evidence =
  async () => {
    const app = new SamchonGraphApplication(SamchonGraphMemory.from(dump()));
    const output = await app.inspect_code_graph({
      question: "Trace the requested command implementation.",
      draft: {
        reason:
          "A tour is the smallest request for the command implementation flow.",
        type: "tour",
      },
      review: "Tour is appropriate for selecting the executable definition.",
      request: {
        type: "tour",
        reinterpretations: ["processCommand"],
        limit: 2,
        includeTests: false,
      },
    });
    if (output.result.type !== "tour")
      throw new Error(`Expected a tour result, got ${output.result.type}.`);

    // `processCommand` resolves to two candidates: a header declaration with no
    // body and one source definition. Only the definition invokes real work, so
    // the tour must open on it — even though the work it invokes reaches the
    // reader through a self-recursive call (which is not production reach) and a
    // call edge that carries no evidence span (which is still one call site).
    TestValidator.equals(
      "a recursive, evidence-less definition is followed past its header",
      output.result.entrypoints[0]?.id,
      "server.c#processCommand:function",
    );
  };

const dump = (): ISamchonGraphDump => ({
  project: "/redis",
  languages: ["c"],
  indexer: "lsp",
  nodes: [
    callable("server.h", "processCommand", true),
    callable("server.c", "processCommand", false),
    callable("command.c", "execute", false),
  ],
  edges: [
    { from: "server.h", to: "server.h#processCommand:function", kind: "exports" },
    // The definition calls itself: a self-recursive invoke edge is not a
    // production call site, so `productionInvocationOut` must skip it.
    {
      from: "server.c#processCommand:function",
      to: "server.c#processCommand:function",
      kind: "calls",
      evidence: { file: "server.c", startLine: 7 },
    },
    // The definition's one real call carries no evidence span (some servers
    // report a target without a location); it still counts as one call site.
    {
      from: "server.c#processCommand:function",
      to: "command.c#execute:function",
      kind: "calls",
    },
  ],
});

const callable = (file: string, name: string, exported: boolean) => ({
  id: `${file}#${name}:function`,
  kind: "function" as const,
  language: "c" as const,
  name,
  file,
  external: false,
  ...(exported ? { exported: true } : {}),
  evidence: { file, startLine: 1, endLine: 5 },
});
