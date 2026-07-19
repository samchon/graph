import { TestValidator } from "@nestia/e2e";
import {
  SamchonGraphApplication,
  SamchonGraphMemory,
  type ISamchonGraphDump,
  type ISamchonGraphTrace,
} from "@samchon/graph";

/** Trace existence and completeness are separate facts. */
export const test_trace_reports_only_actual_omissions = async () => {
  const graph = SamchonGraphMemory.from(dump());
  const app = new SamchonGraphApplication(graph);
  const inspect = async (
    request: ISamchonGraphTrace.IRequest,
  ): Promise<Awaited<ReturnType<SamchonGraphApplication["inspect_code_graph"]>>> =>
    app.inspect_code_graph({
      question: "Trace the selected path.",
      draft: { reason: "Follow the exact handles.", type: "trace" },
      review: "Inspect the bounded result.",
      request,
    });

  const self = await inspect({ type: "trace", from: A, to: A });
  const selfResult = self.result as ISamchonGraphTrace;
  TestValidator.equals("a node has a zero-hop path to itself", selfResult.path, [
    { id: A, name: "a", kind: "function", file: "src/a.ts", depth: 0 },
  ]);
  TestValidator.equals("a self path has no hops", selfResult.hops, []);
  TestValidator.equals("a self path has no fake junctions", selfResult.junctions, undefined);
  TestValidator.equals("a self path is an answer", self.next.action, "answer");

  const complete = await inspect({ type: "trace", from: A, maxDepth: 1 });
  TestValidator.equals(
    "an exact-depth leaf is complete",
    (complete.result as ISamchonGraphTrace).truncated,
    false,
  );

  const omitted = await inspect({ type: "trace", from: ROOT, maxDepth: 1 });
  TestValidator.equals(
    "a depth boundary with an eligible continuation is truncated",
    (omitted.result as ISamchonGraphTrace).truncated,
    true,
  );
};

const ROOT = "src/a.ts#root:function";
const A = "src/a.ts#a:function";
const LEAF = "src/a.ts#leaf:function";

const dump = (): ISamchonGraphDump => ({
  project: "/trace-truth",
  languages: ["typescript"],
  indexer: "lsp",
  nodes: [
    node(ROOT, "root"),
    node(A, "a"),
    node(LEAF, "leaf"),
  ],
  edges: [
    { from: ROOT, to: A, kind: "calls" },
    { from: A, to: LEAF, kind: "calls" },
  ],
});

const node = (id: string, name: string): ISamchonGraphDump.INode => ({
  id,
  kind: "function",
  language: "typescript",
  name,
  file: "src/a.ts",
  external: false,
});
