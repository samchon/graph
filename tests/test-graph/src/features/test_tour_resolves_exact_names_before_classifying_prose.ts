import { TestValidator } from "@nestia/e2e";
import {
  ISamchonGraphDump,
  SamchonGraphApplication,
  SamchonGraphMemory,
} from "@samchon/graph";

/** Quoted identifiers may contain spaces, so resolution must precede prose. */
export const test_tour_resolves_exact_names_before_classifying_prose =
  async () => {
    const dump: ISamchonGraphDump = {
      project: "/kotlin",
      languages: ["kotlin"],
      indexer: "lsp",
      nodes: [
        {
          id: "src/Main.kt#serve:function",
          kind: "function",
          language: "kotlin",
          name: "RuntimeHandler",
          file: "src/Main.kt",
          external: false,
          exported: true,
          evidence: { startLine: 1, endLine: 4 },
        },
        {
          id: "src/Main.kt#run:function",
          kind: "function",
          language: "kotlin",
          name: "run",
          file: "src/Main.kt",
          external: false,
          evidence: { startLine: 6, endLine: 9 },
        },
        {
          id: "src/Notifications.kt#send user notification:function",
          kind: "function",
          language: "kotlin",
          name: "send user notification",
          file: "src/Notifications.kt",
          external: false,
          exported: true,
          evidence: { startLine: 1, endLine: 2 },
        },
      ],
      edges: [
        {
          from: "src/Main.kt",
          to: "src/Main.kt#serve:function",
          kind: "exports",
        },
        {
          from: "src/Notifications.kt",
          to: "src/Notifications.kt#send user notification:function",
          kind: "exports",
        },
        {
          from: "src/Main.kt#serve:function",
          to: "src/Main.kt#run:function",
          kind: "calls",
          evidence: { startLine: 2 },
        },
      ],
    };
    const output = await new SamchonGraphApplication(
      SamchonGraphMemory.from(dump),
    ).inspect_code_graph({
      question: "Show the notification entrypoint.",
      draft: {
        reason: "A tour is the smallest request for the notification entrypoint.",
        type: "tour",
      },
      review: "Tour is appropriate for ranking the notification entrypoint.",
      request: {
        type: "tour",
        reinterpretations: [
          "",
          "send user notification",
          "runtime handler",
        ],
        limit: 1,
        includeTests: false,
      },
    });
    if (output.result.type !== "tour")
      throw new Error(`Expected a tour result, got ${output.result.type}.`);

    TestValidator.equals(
      "an exact whitespace-bearing symbol gets the exact-name seat",
      output.result.entrypoints.map((node) => node.name),
      ["send user notification"],
    );
  };
