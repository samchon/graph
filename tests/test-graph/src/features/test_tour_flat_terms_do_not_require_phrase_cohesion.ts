import { TestValidator } from "@nestia/e2e";
import {
  ISamchonGraphDump,
  SamchonGraphApplication,
  SamchonGraphMemory,
} from "@samchon/graph";

export const test_tour_flat_terms_do_not_require_phrase_cohesion =
  async () => {
    const scattered = [
      "PublicOnly",
      "SurfaceArea",
      "RuntimeVersion",
      "ExecuteOnly",
      "ImplementationDetail",
      "WorkItem",
      "NearbyThing",
      "CleanPath",
      "BehaviorFlag",
      "TestContext",
    ];
    const nodes: ISamchonGraphDump["nodes"] = [
      {
        id: "server.go#Serve:function",
        kind: "function",
        language: "go",
        name: "Serve",
        file: "server.go",
        external: false,
        exported: true,
        evidence: { startLine: 1, startCol: 1, endLine: 3, endCol: 2 },
      },
      {
        id: "worker.go#run:function",
        kind: "function",
        language: "go",
        name: "run",
        file: "worker.go",
        external: false,
        evidence: { startLine: 1, startCol: 1, endLine: 3, endCol: 2 },
      },
      {
        id: "route.go#RouteHandler:function",
        kind: "function",
        language: "go",
        name: "RouteHandler",
        file: "route.go",
        external: false,
        exported: true,
        evidence: { startLine: 1, startCol: 1, endLine: 3, endCol: 2 },
      },
      {
        id: "route.go#dispatch:function",
        kind: "function",
        language: "go",
        name: "dispatch",
        file: "route.go",
        external: false,
        evidence: { startLine: 5, startCol: 1, endLine: 7, endCol: 2 },
      },
      {
        id: "test_helpers.go#CreateTestContext:function",
        kind: "function",
        language: "go",
        name: "CreateTestContext",
        file: "test_helpers.go",
        external: false,
        exported: true,
        evidence: { startLine: 1, startCol: 1, endLine: 4, endCol: 2 },
      },
      {
        id: "noise.go#PublicError:function",
        kind: "function",
        language: "go",
        name: "PublicError",
        file: "noise.go",
        external: false,
        exported: true,
        evidence: { startLine: 1, startCol: 1, endLine: 2, endCol: 2 },
      },
      ...scattered.map(
        (name, index): ISamchonGraphDump["nodes"][number] => ({
          id: `noise${index}.go#${name}:function`,
          kind: "function",
          language: "go",
          name,
          file: `noise${index}.go`,
          external: false,
          exported: true,
          evidence: { startLine: 1, startCol: 1, endLine: 2, endCol: 2 },
        }),
      ),
    ];
    const edges: ISamchonGraphDump["edges"] = [
      { from: "server.go", to: "server.go#Serve:function", kind: "exports" },
      { from: "route.go", to: "route.go#RouteHandler:function", kind: "exports" },
      {
        from: "server.go#Serve:function",
        to: "worker.go#run:function",
        kind: "calls",
        evidence: { startLine: 2, startCol: 2, endLine: 2, endCol: 5 },
      },
      {
        from: "route.go#RouteHandler:function",
        to: "route.go#dispatch:function",
        kind: "calls",
        evidence: { startLine: 2, startCol: 2, endLine: 2, endCol: 10 },
      },
      {
        from: "test_helpers.go",
        to: "test_helpers.go#CreateTestContext:function",
        kind: "exports",
      },
      {
        from: "test_helpers.go#CreateTestContext:function",
        to: "worker.go#run:function",
        kind: "calls",
        evidence: { startLine: 2, startCol: 2, endLine: 2, endCol: 5 },
      },
      {
        from: "test_helpers.go#CreateTestContext:function",
        to: "route.go#dispatch:function",
        kind: "calls",
        evidence: { startLine: 3, startCol: 2, endLine: 3, endCol: 10 },
      },
      {
        from: "noise.go",
        to: "noise.go#PublicError:function",
        kind: "exports",
      },
      ...scattered.map(
        (name, index): ISamchonGraphDump["edges"][number] => ({
          from: `noise${index}.go`,
          to: `noise${index}.go#${name}:function`,
          kind: "exports",
        }),
      ),
    ];
    const app = new SamchonGraphApplication(
      SamchonGraphMemory.from({
        project: "/repo",
        languages: ["go"],
        indexer: "lsp",
        nodes,
        edges,
      }),
    );
    const broad = await app.inspect_code_graph({
      question: "Show the central runtime flow.",
      draft: {
        reason: "A tour is the smallest request for the central runtime flow.",
        type: "tour",
      },
      review: "Tour is appropriate for ranking the central runtime flow.",
      request: {
        type: "tour",
        reinterpretations: [
          "public surface",
          "runtime execution",
          "implementation work",
          "nearby path",
          "behavior tests",
        ],
        limit: 5,
      },
    });
    if (broad.result.type !== "tour")
      throw new Error(`Expected a tour result, got ${broad.result.type}.`);
    TestValidator.equals(
      "flat one-stem matches participate without a cohesion gate",
      broad.result.entrypoints.some((node) => node.name === "Serve"),
      false,
    );

    const cohesive = await app.inspect_code_graph({
      question: "Show the route handler.",
      draft: {
        reason: "A tour is the smallest request for the route handler.",
        type: "tour",
      },
      review: "Tour is appropriate for ranking the route handler.",
      request: {
        type: "tour",
        reinterpretations: ["route handler"],
        limit: 1,
      },
    });
    if (cohesive.result.type !== "tour")
      throw new Error(`Expected a tour result, got ${cohesive.result.type}.`);
    TestValidator.equals(
      "a phrase whose stems converge on one symbol still drives ranking",
      cohesive.result.entrypoints[0]?.name,
      "RouteHandler",
    );

    const structural = await app.inspect_code_graph({
      question: "Show the central flow and its error surface.",
      draft: {
        reason: "A tour is the smallest request for the structural flow.",
        type: "tour",
      },
      review: "Tour is appropriate for ranking the structural flow.",
      request: { type: "tour", reinterpretations: [], limit: 1 },
    });
    const emptyClause = await app.inspect_code_graph({
      question: "Show the central flow.",
      draft: {
        reason: "A tour is the smallest request for the central flow.",
        type: "tour",
      },
      review: "Tour is appropriate for ranking the central flow.",
      request: { type: "tour", reinterpretations: ["go"], limit: 1 },
    });
    if (structural.result.type !== "tour")
      throw new Error(`Expected a tour result, got ${structural.result.type}.`);
    if (emptyClause.result.type !== "tour")
      throw new Error(`Expected a tour result, got ${emptyClause.result.type}.`);
    TestValidator.equals(
      "short non-symbol terms do not perturb the structural lane",
      emptyClause.result.entrypoints.map((node) => node.name),
      structural.result.entrypoints.map((node) => node.name),
    );
    const crossClause = await app.inspect_code_graph({
      question: "Show the central flow and its error surface.",
      draft: {
        reason: "A tour is the smallest request for the cross-clause flow.",
        type: "tour",
      },
      review: "Tour is appropriate for ranking the cross-clause flow.",
      request: {
        type: "tour",
        reinterpretations: ["public surface", "error lifecycle"],
        limit: 1,
      },
    });
    if (crossClause.result.type !== "tour")
      throw new Error(`Expected a tour result, got ${crossClause.result.type}.`);
    TestValidator.equals(
      "flat terms may rank a matching leaf without a multi-term cohesion gate",
      crossClause.result.entrypoints.map((node) => node.name),
      ["PublicError"],
    );

    const testHelper = await app.inspect_code_graph({
      question: "Show the central behavior and its tests.",
      draft: {
        reason: "A tour is the smallest request for behavior and test context.",
        type: "tour",
      },
      review: "Tour is appropriate for ranking behavior and test context.",
      request: {
        type: "tour",
        reinterpretations: ["behavior tests"],
        limit: 1,
      },
    });
    if (testHelper.result.type !== "tour")
      throw new Error(`Expected a tour result, got ${testHelper.result.type}.`);
    TestValidator.equals(
      "a matching root helper participates in the same flat ranking lane",
      testHelper.result.entrypoints[0]?.file === "test_helpers.go",
      true,
    );
  };
