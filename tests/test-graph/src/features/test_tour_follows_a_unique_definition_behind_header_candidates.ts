import { TestValidator } from "@nestia/e2e";
import {
  ISamchonGraphDump,
  SamchonGraphApplication,
  SamchonGraphMemory,
} from "@samchon/graph";

export const test_tour_follows_a_unique_definition_behind_header_candidates =
  async () => {
    const app = new SamchonGraphApplication(SamchonGraphMemory.from(dump()));
    const output = await app.inspect_code_graph({
      question: "Trace the requested command implementation.",
      draft: {
        reason: "A tour is the smallest request for the command implementation flow.",
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

    TestValidator.equals(
      "a header declaration and one executable definition name the definition",
      output.result.entrypoints[0]?.id,
      "server.c#processCommand:function",
    );
  };

const dump = (): ISamchonGraphDump => {
  const workers = Array.from({ length: 12 }, (_, index) => ({
    id: `support${index}.c#support${index}:function`,
    kind: "function" as const,
    language: "c" as const,
    name: `support${index}`,
    file: `support${index}.c`,
    external: false,
    evidence: { file: `support${index}.c`, startLine: 1, endLine: 2 },
  }));
  return {
    project: "/redis",
    languages: ["c"],
    indexer: "lsp",
    nodes: [
      callable("server.h", "processCommand", true),
      callable("server.c", "processCommand", false),
      callable("main.c", "bootstrap", true),
      callable("command.c", "execute", false),
      ...workers,
    ],
    edges: [
      { from: "server.h", to: "server.h#processCommand:function", kind: "exports" },
      { from: "main.c", to: "main.c#bootstrap:function", kind: "exports" },
      call("server.c#processCommand:function", "command.c#execute:function", 10),
      ...workers.map((worker, index) =>
        call("main.c#bootstrap:function", worker.id, 20 + index),
      ),
    ],
  };
};

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

const call = (from: string, to: string, line: number) => ({
  from,
  to,
  kind: "calls" as const,
  evidence: { file: from.slice(0, from.indexOf("#")), startLine: line },
});
