import { TestValidator } from "@nestia/e2e";
import {
  ISamchonGraphDump,
  SamchonGraphApplication,
  SamchonGraphMemory,
} from "@samchon/graph";

export const test_tour_preserves_ranked_flow_seed_order =
  async () => {
    const drivers = ["Entry", "Route", "Handler", "Registration"];
    const nodes: ISamchonGraphDump["nodes"] = [
      {
        id: "flow.go#AbortControlFlow:function",
        kind: "function",
        language: "go",
        name: "AbortControlFlow",
        file: "flow.go",
        external: false,
        exported: true,
        evidence: { startLine: 1, startCol: 1, endLine: 3, endCol: 2 },
      },
      {
        id: "flow.go#state:variable",
        kind: "variable",
        language: "go",
        name: "state",
        file: "flow.go",
        external: false,
        evidence: { startLine: 5, startCol: 1, endLine: 5, endCol: 6 },
      },
    ];
    const edges: ISamchonGraphDump["edges"] = [
      {
        from: "flow.go",
        to: "flow.go#AbortControlFlow:function",
        kind: "exports",
      },
      {
        from: "flow.go#AbortControlFlow:function",
        to: "flow.go#state:variable",
        kind: "accesses",
        evidence: { startLine: 2, startCol: 2, endLine: 2, endCol: 7 },
      },
    ];
    drivers.forEach((name, index) => {
      const line = 10 + index * 5;
      const driver = `flow.go#${name}:function`;
      const leaf = `flow.go#${name}Work:function`;
      nodes.push(
        {
          id: driver,
          kind: "function",
          language: "go",
          name,
          file: "flow.go",
          external: false,
          exported: true,
          evidence: {
            startLine: line,
            startCol: 1,
            endLine: line + 2,
            endCol: 2,
          },
        },
        {
          id: leaf,
          kind: "function",
          language: "go",
          name: `${name}Work`,
          file: "flow.go",
          external: false,
          evidence: {
            startLine: line + 3,
            startCol: 1,
            endLine: line + 4,
            endCol: 2,
          },
        },
      );
      edges.push(
        {
          from: driver,
          to: leaf,
          kind: "calls",
          evidence: {
            startLine: line + 1,
            startCol: 2,
            endLine: line + 1,
            endCol: 10,
          },
        },
      );
    });
    const dump: ISamchonGraphDump = {
      project: "/repo",
      languages: ["go"],
      indexer: "lsp",
      nodes,
      edges,
    };
    const output = await new SamchonGraphApplication(
      SamchonGraphMemory.from(dump),
    ).inspect_code_graph({
      question: "Show the runtime flow.",
      draft: {
        reason: "A tour is the smallest request for the runtime flow.",
        type: "tour",
      },
      review: "Tour is appropriate for ranking the runtime flow.",
      request: {
        type: "tour",
        reinterpretations: ["AbortControlFlow", ...drivers],
        limit: 5,
      },
    });
    if (output.result.type !== "tour")
      throw new Error(`Expected a tour result, got ${output.result.type}.`);
    TestValidator.equals(
      "the state-only symbol is ranked as an entrypoint by the explicit terms",
      output.result.entrypoints[0]?.name,
      "AbortControlFlow",
    );
    TestValidator.equals(
      "flow slots preserve seed ranking without invocation reordering",
      output.result.primaryFlow.map((flow) => flow.start.name),
      ["AbortControlFlow", "Entry", "Route", "Handler"],
    );
  };
