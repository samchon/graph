import { TestValidator } from "@nestia/e2e";
import {
  SamchonGraphApplication,
  SamchonGraphMemory,
  SamchonGraphSourceReader,
  type ISamchonGraphDump,
  type ISamchonGraphTrace,
} from "@samchon/graph";

/** Trace existence and completeness are separate facts. */
export const test_trace_reports_only_actual_omissions = async () => {
  const graph = SamchonGraphMemory.from(
    dump(),
    new SamchonGraphSourceReader("/trace-truth", {
      texts: new Map([["src/dispatch.ts", "run(): void;\n"]]),
    }),
  );
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

  const boundedPath = await inspect({
    type: "trace",
    from: CHAIN[0]!,
    to: CHAIN[13]!,
    maxDepth: 12,
  });
  TestValidator.equals(
    "a path beyond maxDepth is incomplete rather than nonexistent",
    (boundedPath.result as ISamchonGraphTrace).truncated,
    true,
  );
  TestValidator.equals(
    "an incomplete bounded path asks for another inspection",
    boundedPath.next.action,
    "inspect",
  );

  const directDispatch = await inspect({
    type: "trace",
    from: DISPATCH_BASE,
    to: DISPATCH_IMPLEMENTATIONS[12]!,
  });
  TestValidator.equals(
    "an explicit dispatch target remains reachable through a suppressed hub",
    (directDispatch.result as ISamchonGraphTrace).path?.map((entry) => entry.id),
    [DISPATCH_BASE, DISPATCH_IMPLEMENTATIONS[12]!],
  );
  TestValidator.equals(
    "a resolved path keeps the implementation signature held by the snapshot",
    (directDispatch.result as ISamchonGraphTrace).path?.[1]?.signature,
    "run(): void;",
  );

  const boundedDispatch = await inspect({
    type: "trace",
    from: DISPATCH_BASE,
    to: OUTSIDE,
  });
  TestValidator.equals(
    "eligible dispatch-hub omissions make an unresolved path incomplete",
    (boundedDispatch.result as ISamchonGraphTrace).truncated,
    true,
  );

  const externalDispatch = await inspect({
    type: "trace",
    from: EXTERNAL_DISPATCH_BASE,
    to: OUTSIDE,
  });
  TestValidator.equals(
    "excluded external dispatch endpoints do not claim truncation",
    (externalDispatch.result as ISamchonGraphTrace).truncated,
    false,
  );
  TestValidator.equals(
    "a fully searched disconnected path remains outside",
    externalDispatch.next.action,
    "outside",
  );
};

const ROOT = "src/a.ts#root:function";
const A = "src/a.ts#a:function";
const LEAF = "src/a.ts#leaf:function";
const CHAIN = Array.from(
  { length: 14 },
  (_, index) => `src/chain.ts#step${String(index)}:function`,
);
const DISPATCH_BASE = "src/dispatch.ts#Base.run:method";
const DISPATCH_IMPLEMENTATIONS = Array.from(
  { length: 13 },
  (_, index) => `src/dispatch.ts#Impl${String(index)}.run:method`,
);
const EXTERNAL_DISPATCH_BASE = "src/dispatch.ts#ExternalBase.run:method";
const EXTERNAL_IMPLEMENTATIONS = Array.from(
  { length: 12 },
  (_, index) => `vendor/dispatch.ts#External${String(index)}.run:method`,
);
const OUTSIDE = "src/outside.ts#outside:function";

const dump = (): ISamchonGraphDump => ({
  project: "/trace-truth",
  languages: ["typescript"],
  indexer: "lsp",
  nodes: [
    node(ROOT, "root"),
    node(A, "a"),
    node(LEAF, "leaf"),
    ...CHAIN.map((id, index) => node(id, `step${String(index)}`)),
    node(DISPATCH_BASE, "Base.run", "method"),
    ...DISPATCH_IMPLEMENTATIONS.flatMap((id, index) => [
      node(
        id,
        `Impl${String(index)}.run`,
        "method",
        false,
        index === 12,
      ),
      node(`${id}.body`, `body${String(index)}`),
    ]),
    node(EXTERNAL_DISPATCH_BASE, "ExternalBase.run", "method"),
    ...EXTERNAL_IMPLEMENTATIONS.flatMap((id, index) => [
      node(id, `External${String(index)}.run`, "method", true),
      node(`${id}.body`, `externalBody${String(index)}`, "function", true),
    ]),
    node(OUTSIDE, "outside"),
  ],
  edges: [
    { from: ROOT, to: A, kind: "calls" },
    { from: A, to: LEAF, kind: "calls" },
    ...CHAIN.slice(0, -1).map((id, index) => ({
      from: id,
      to: CHAIN[index + 1]!,
      kind: "calls" as const,
    })),
    ...DISPATCH_IMPLEMENTATIONS.flatMap((id) => [
      { from: id, to: DISPATCH_BASE, kind: "implements" as const },
      { from: id, to: `${id}.body`, kind: "calls" as const },
    ]),
    ...EXTERNAL_IMPLEMENTATIONS.flatMap((id) => [
      { from: id, to: EXTERNAL_DISPATCH_BASE, kind: "implements" as const },
      { from: id, to: `${id}.body`, kind: "calls" as const },
    ]),
  ],
});

const node = (
  id: string,
  name: string,
  kind: ISamchonGraphDump.INode["kind"] = "function",
  external = false,
  withEvidence = false,
): ISamchonGraphDump.INode => ({
  id,
  kind,
  language: "typescript",
  name,
  file: id.slice(0, id.indexOf("#")),
  external,
  ...(withEvidence ? { evidence: { startLine: 1, endLine: 1 } } : {}),
});
