import { TestValidator } from "@nestia/e2e";

// `adaptTtscGraphDump` is internal to the package, so it is reached by path
// rather than through the public barrel.
import { adaptTtscGraphDump } from "../../../../packages/graph/src/provider/ttscgraph/adaptTtscGraphDump";
import { GraphPaths } from "../internal/GraphPaths";

/**
 * The strict adapter is the trust boundary between raw compiler output and the
 * semantic graph. It preserves the facts a healthy dump carries and rejects
 * every malformed identity, type, endpoint, span, and collision instead of
 * repairing or silently dropping it.
 */
export const test_ttscgraph_dump_adapter_rejects_malformed_facts = async () => {
  const project = GraphPaths.createTempDirectory("samchon-graph-ttscgraph-adapt-");

  const good = () => ({
    project,
    nodes: [
      { id: "src/a.ts#src/a.ts:module", kind: "module", name: "src/a.ts", file: "src/a.ts", external: false },
      { id: "src/a.ts#foo:function", kind: "function", name: "foo", file: "src/a.ts", external: false },
    ] as unknown[],
    edges: [
      { from: "src/a.ts#src/a.ts:module", to: "src/a.ts#foo:function", kind: "exports" },
    ] as unknown[],
  });
  const mutate = (change: (dump: ReturnType<typeof good>) => void): unknown => {
    const dump = good();
    change(dump);
    return dump;
  };

  // A healthy dump adapts without throwing (the negative twin of every case).
  TestValidator.predicate(
    "a well-formed dump adapts cleanly",
    adaptTtscGraphDump(good(), project).nodes.length === 2,
  );

  // Identity and project scope.
  rejects(() => adaptTtscGraphDump("not-an-object", project), "a non-object dump");
  rejects(
    () => adaptTtscGraphDump(mutate((d) => (d.project = `${project}-other`)), project),
    "a dump whose project does not match the requested root",
  );

  // Structural types.
  rejects(() => adaptTtscGraphDump(mutate((d) => ((d as { nodes: unknown }).nodes = "x")), project), "a non-array nodes field");
  rejects(() => adaptTtscGraphDump(mutate((d) => ((d.nodes[1] as { id: unknown }).id = 123)), project), "a non-string node id");
  rejects(() => adaptTtscGraphDump(mutate((d) => ((d.nodes[1] as { external: unknown }).external = "no")), project), "a non-boolean external flag");
  rejects(() => adaptTtscGraphDump(mutate((d) => ((d.nodes[1] as { kind: unknown }).kind = "banana")), project), "an unsupported node kind");
  rejects(() => adaptTtscGraphDump(mutate((d) => ((d.nodes[1] as { modifiers: unknown }).modifiers = ["banana"])), project), "an unsupported modifier");
  rejects(() => adaptTtscGraphDump(mutate((d) => ((d.edges[0] as { kind: unknown }).kind = "banana")), project), "an unsupported edge kind");

  // Identity format and uniqueness.
  rejects(() => adaptTtscGraphDump(mutate((d) => ((d.nodes[1] as { id: string }).id = "no-hash-here")), project), "a node id that does not encode its file and kind");
  rejects(() => adaptTtscGraphDump(mutate((d) => d.nodes.push({ ...(d.nodes[1] as object) })), project), "a duplicate node id");

  // Edge endpoints and uniqueness.
  rejects(() => adaptTtscGraphDump(mutate((d) => ((d.edges[0] as { from: string }).from = "src/a.ts#ghost:function")), project), "an edge from an unknown endpoint");
  rejects(() => adaptTtscGraphDump(mutate((d) => d.edges.push({ ...(d.edges[0] as object) })), project), "a duplicate edge after module folding");

  // Evidence spans and decorator literals.
  rejects(() => adaptTtscGraphDump(mutate((d) => ((d.nodes[1] as { evidence: unknown }).evidence = { startLine: 0 })), project), "a non-positive evidence line");
  rejects(() => adaptTtscGraphDump(mutate((d) => ((d.nodes[1] as { evidence: unknown }).evidence = { startLine: 1, endCol: 5 })), project), "an evidence endCol without an endLine");
  rejects(
    () =>
      adaptTtscGraphDump(
        mutate((d) => ((d.nodes[1] as { decorators: unknown }).decorators = [{ name: "X", arguments: [{ literal: {} }] }])),
        project,
      ),
    "a non-scalar decorator literal",
  );

  // A rich but valid dump preserves optional facts, folds only module endpoints,
  // and admits an external non-bundled dependency.
  const rich = adaptTtscGraphDump(
    {
      project,
      nodes: [
        { id: "src/a.ts#src/a.ts:module", kind: "module", name: "src/a.ts", file: "src/a.ts", external: false },
        {
          id: "src/a.ts#foo:function",
          kind: "function",
          name: "foo",
          file: "src/a.ts",
          external: false,
          qualifiedName: "pkg.foo",
          modifiers: ["export", "async"],
          decorators: [{ name: "Route", arguments: [{ literal: "path" }, {}] }],
          evidence: { startLine: 1, startCol: 1, endLine: 1, endCol: 5 },
          implementation: { startLine: 2 },
        },
        { id: "src/a.ts#bar:function", kind: "function", name: "bar", file: "src/a.ts", external: false },
        { id: "vendor/dep.ts#Dep:interface", kind: "interface", name: "Dep", file: "vendor/dep.ts", external: true },
      ],
      edges: [
        { from: "src/a.ts#src/a.ts:module", to: "src/a.ts#foo:function", kind: "exports" },
        { from: "src/a.ts#foo:function", to: "src/a.ts#bar:function", kind: "calls" },
      ],
    },
    project,
  );
  const foo = rich.nodes.find((node) => node.id === "src/a.ts#foo:function");
  TestValidator.equals("a qualified name is preserved", foo?.qualifiedName, "pkg.foo");
  TestValidator.equals("an implementation span is preserved", foo?.implementation?.startLine, 2);
  TestValidator.equals(
    "a decorator keeps its scalar and its empty argument",
    foo?.decorators?.[0]?.arguments,
    [{ literal: "path" }, {}],
  );
  TestValidator.predicate(
    "a module export edge folds onto its file while a non-module call keeps its endpoint",
    rich.edges.some((edge) => edge.kind === "exports" && edge.from === "src/a.ts") &&
      rich.edges.some((edge) => edge.kind === "calls" && edge.from === "src/a.ts#foo:function"),
  );
  TestValidator.predicate(
    "an external non-bundled dependency remains an external fact",
    rich.nodes.some((node) => node.id === "vendor/dep.ts#Dep:interface" && node.external),
  );
};

function rejects(task: () => unknown, label: string): void {
  let error: unknown;
  try {
    task();
  } catch (caught) {
    error = caught;
  }
  TestValidator.predicate(`${label} is rejected`, error instanceof Error);
}
