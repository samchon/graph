import { TestValidator } from "@nestia/e2e";
import {
  type ISamchonGraphDump,
  type ISamchonGraphNode,
  type ISamchonGraphTrace,
  SamchonGraphApplication,
  SamchonGraphMemory,
} from "@samchon/graph";

export const test_trace_reports_dispatch_hub_omissions = async () => {
  const internal = await inspect(false);
  TestValidator.equals(
    "an omitted in-scope dispatch fanout is reported",
    internal.truncated,
    true,
  );
  TestValidator.equals(
    "a dispatch hub stays a leaf in the bounded response",
    [internal.hops.length, internal.reached.length],
    [0, 0],
  );

  const external = await inspect(true);
  TestValidator.equals(
    "excluded external dispatch candidates are not omissions",
    external.truncated,
    false,
  );
};

const inspect = async (external: boolean): Promise<ISamchonGraphTrace> => {
  const app = new SamchonGraphApplication(SamchonGraphMemory.from(dump(external)));
  return (
    await app.inspect_code_graph({
      question: "where does this declaration dispatch",
      draft: { reason: "Trace dispatch completeness.", type: "trace" },
      review: "Trace dispatch completeness.",
      request: { type: "trace", from: BASE },
    })
  ).result as ISamchonGraphTrace;
};

const BASE = "src/base.ts#Base.run:method";
const implementations = Array.from({ length: 12 }, (_, index) => ({
  implementation: `src/impl-${String(index)}.ts#Impl${String(index)}.run:method`,
  leaf: `src/impl-${String(index)}.ts#work${String(index)}:function`,
  file: `src/impl-${String(index)}.ts`,
}));

const dump = (external: boolean): ISamchonGraphDump => ({
  project: "/trace-dispatch-hub",
  languages: ["typescript"],
  indexer: "lsp",
  nodes: [
    node(BASE, "Base.run", "src/base.ts", false),
    ...implementations.flatMap(({ implementation, leaf, file }) => [
      node(implementation, implementation.split("#")[1]!.split(":")[0]!, file, external),
      node(leaf, leaf.split("#")[1]!.split(":")[0]!, file, external),
    ]),
  ],
  edges: implementations.flatMap(({ implementation, leaf }) => [
    { from: implementation, to: BASE, kind: "implements" as const },
    { from: implementation, to: leaf, kind: "calls" as const },
  ]),
});

const node = (
  id: string,
  name: string,
  file: string,
  external: boolean,
): ISamchonGraphNode => ({
  id,
  kind: id.endsWith(":method") ? "method" : "function",
  language: "typescript",
  name,
  qualifiedName: name,
  file,
  external,
  evidence: { file, startLine: 1, endLine: 1 },
});
