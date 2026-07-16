import { TestValidator } from "@nestia/e2e";
import {
  ISamchonGraphDump,
  SamchonGraphApplication,
  SamchonGraphMemory,
} from "@samchon/graph";

export const test_trace_expands_each_parent_in_queue_order =
  async () => {
    const stateIds = Array.from(
      { length: 12 },
      (_, index) => `runtime.go#state${index}:variable`,
    );
    const dump: ISamchonGraphDump = {
      project: "/repo",
      languages: ["go"],
      indexer: "lsp",
      nodes: [
        node("runtime.go#Start:function", "Start", 1),
        node("runtime.go#reset:function", "reset", 5),
        node("runtime.go#dispatch:function", "dispatch", 9),
        node("worker.go#work:function", "work", 1),
        ...stateIds.map((id, index) =>
          node(id, `state${index}`, 20 + index, "variable"),
        ),
      ],
      edges: [
        call("runtime.go#Start:function", "runtime.go#reset:function", 2),
        call("runtime.go#Start:function", "runtime.go#dispatch:function", 3),
        ...stateIds.map(
          (id, index): ISamchonGraphDump["edges"][number] => ({
            from: "runtime.go#reset:function",
            to: id,
            kind: "accesses",
            evidence: {
              file: "runtime.go",
              startLine: 6,
              startCol: index + 1,
              endLine: 6,
              endCol: index + 2,
            },
          }),
        ),
        call("runtime.go#dispatch:function", "worker.go#work:function", 10),
      ],
    };
    const traceOutput = await new SamchonGraphApplication(
      SamchonGraphMemory.from(dump),
    ).inspect_code_graph({
      question: "Trace the central runtime work.",
      draft: {
        reason: "A trace is the smallest request for the central runtime work.",
        type: "trace",
      },
      review: "Trace is appropriate for following the central runtime work.",
      request: {
        type: "trace",
        from: "Start",
        direction: "forward",
        focus: "execution",
        maxDepth: 3,
        maxNodes: 12,
      },
    });
    if (traceOutput.result.type !== "trace")
      throw new Error(
        `Expected a trace result, got ${traceOutput.result.type}.`,
      );
    const trace = traceOutput.result;

    TestValidator.equals(
      "each parent expands fully before the next breadth peer",
      trace.reached.map((item) => item.name),
      [
        "reset",
        "dispatch",
        ...Array.from({ length: 10 }, (_, index) => `state${index}`),
      ],
    );

    const denseOutput = await new SamchonGraphApplication(
      SamchonGraphMemory.from(denseDump()),
    ).inspect_code_graph({
      question: "Trace through the dispatcher despite its policy fan-out.",
      draft: {
        reason: "A trace is the smallest request through the dispatcher.",
        type: "trace",
      },
      review: "Trace is appropriate for following the dispatcher.",
      request: {
        type: "trace",
        from: "Start",
        direction: "forward",
        focus: "execution",
        maxDepth: 3,
        maxNodes: 12,
      },
    });
    if (denseOutput.result.type !== "trace")
      throw new Error(
        `Expected a trace result, got ${denseOutput.result.type}.`,
      );
    const dense = denseOutput.result;
    TestValidator.equals(
      "the canonical comparator does not inspect endpoint continuation counts",
      dense.reached.some((item) => item.name === "execute"),
      false,
    );
  };

const denseDump = (): ISamchonGraphDump => {
  const checks = Array.from({ length: 14 }, (_, index) =>
    node(`checks.go#check${index}:function`, `check${index}`, 20 + index),
  );
  return {
    project: "/repo",
    languages: ["go"],
    indexer: "lsp",
    nodes: [
      node("runtime.go#Start:function", "Start", 1),
      node("runtime.go#policy:function", "policy", 5),
      node("runtime.go#execute:function", "execute", 100),
      node("worker.go#work:function", "work", 1),
      ...checks,
    ],
    edges: [
      call("runtime.go#Start:function", "runtime.go#policy:function", 2),
      ...checks.map((check, index) =>
        call("runtime.go#policy:function", check.id, 6 + index),
      ),
      call("runtime.go#policy:function", "runtime.go#execute:function", 99),
      call("runtime.go#execute:function", "worker.go#work:function", 101),
    ],
  };
};

const node = (
  id: string,
  name: string,
  line: number,
  kind: "function" | "variable" = "function",
): ISamchonGraphDump["nodes"][number] => ({
  id,
  kind,
  language: "go",
  name,
  file: id.slice(0, id.indexOf("#")),
  external: false,
  evidence: {
    file: id.slice(0, id.indexOf("#")),
    startLine: line,
    startCol: 1,
    endLine: line,
    endCol: 2,
  },
});

const call = (
  from: string,
  to: string,
  line: number,
): ISamchonGraphDump["edges"][number] => ({
  from,
  to,
  kind: "calls",
  evidence: {
    file: "runtime.go",
    startLine: line,
    startCol: 1,
    endLine: line,
    endCol: 2,
  },
});
