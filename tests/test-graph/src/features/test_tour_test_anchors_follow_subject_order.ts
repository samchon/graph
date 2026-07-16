import { TestValidator } from "@nestia/e2e";
import {
  ISamchonGraphDump,
  SamchonGraphApplication,
  SamchonGraphMemory,
} from "@samchon/graph";

export const test_tour_test_anchors_follow_subject_order = async () => {
  const nodes: ISamchonGraphDump["nodes"] = [
    node("first.go#First:function", "First", "first.go", 1),
    node("second.go#Second:function", "Second", "second.go", 1),
    node("first.go#firstWork:function", "firstWork", "first.go", 5, false),
    node(
      "second.go#secondWork:function",
      "secondWork",
      "second.go",
      5,
      false,
    ),
  ];
  const edges: ISamchonGraphDump["edges"] = [
    { from: "first.go", to: "first.go#First:function", kind: "exports" },
    { from: "second.go", to: "second.go#Second:function", kind: "exports" },
    call("first.go#First:function", "first.go#firstWork:function", "first.go", 2),
    call(
      "second.go#Second:function",
      "second.go#secondWork:function",
      "second.go",
      2,
    ),
  ];
  for (let index = 0; index < 4; index++) {
    const id = `first_test.go#TestFirst${index}:function`;
    nodes.push(node(id, `TestFirst${index}`, "first_test.go", 1 + index * 4));
    edges.push(call(id, "first.go#First:function", "first_test.go", 2 + index * 4));
  }
  nodes.push({
    ...node(
      "second_test.go#TestSecond:function",
      "TestSecond",
      "second_test.go",
      1,
    ),
    evidence: {
      file: "second_test.go",
      startLine: 1,
      startCol: 1,
      endLine: 10,
      endCol: 2,
    },
  });
  nodes.push({
    id: "second_test.go#TestSecond.result:variable",
    kind: "variable",
    language: "go",
    name: "result",
    qualifiedName: "TestSecond.result",
    file: "second_test.go",
    external: false,
    evidence: {
      file: "second_test.go",
      startLine: 2,
      startCol: 2,
      endLine: 2,
      endCol: 8,
    },
  });
  edges.push({
    from: "second_test.go#TestSecond:function",
    to: "second_test.go#TestSecond.result:variable",
    kind: "contains",
  });
  nodes.push({
    id: "second_test.go#fixture:variable",
    kind: "variable",
    language: "go",
    name: "fixture",
    file: "second_test.go",
    external: false,
    evidence: {
      file: "second_test.go",
      startLine: 12,
      startCol: 1,
      endLine: 12,
      endCol: 8,
    },
  });
  edges.push(
    call(
      "second_test.go#TestSecond.result:variable",
      "second.go#Second:function",
      "second_test.go",
      2,
    ),
  );
  edges.push(
    call(
      "second_test.go#fixture:variable",
      "second.go#Second:function",
      "second_test.go",
      12,
    ),
  );

  const output = await new SamchonGraphApplication(
    SamchonGraphMemory.from({
      project: "/repo",
      languages: ["go"],
      indexer: "lsp",
      nodes,
      edges,
    }),
  ).inspect_code_graph({
    question: "Show both runtime seams and their tests.",
    draft: {
      reason: "A tour is the smallest request for both runtime seams and tests.",
      type: "tour",
    },
    review: "Tour is appropriate for combining runtime flows and test anchors.",
    request: {
      type: "tour",
      reinterpretations: ["First", "Second"],
      limit: 2,
    },
  });
  if (output.result.type !== "tour")
    throw new Error(`Expected a tour result, got ${output.result.type}.`);
  const result = output.result;

  TestValidator.equals(
    "test anchors follow subject order without a cross-subject interleaving policy",
    result.tests.some((anchor) => anchor.name === "TestSecond"),
    false,
  );
};

const node = (
  id: string,
  name: string,
  file: string,
  line: number,
  exported = true,
): ISamchonGraphDump["nodes"][number] => ({
  id,
  kind: "function",
  language: "go",
  name,
  file,
  external: false,
  ...(exported ? { exported: true } : {}),
  evidence: {
    file,
    startLine: line,
    startCol: 1,
    endLine: line + 2,
    endCol: 2,
  },
});

const call = (
  from: string,
  to: string,
  file: string,
  line: number,
): ISamchonGraphDump["edges"][number] => ({
  from,
  to,
  kind: "calls",
  evidence: {
    file,
    startLine: line,
    startCol: 1,
    endLine: line,
    endCol: 2,
  },
});
