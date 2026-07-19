import { TestValidator } from "@nestia/e2e";
import {
  SamchonGraphApplication,
  SamchonGraphMemory,
  type ISamchonGraphDetails,
  type ISamchonGraphDump,
} from "@samchon/graph";

/**
 * Details must consume identity facts already owned by the graph snapshot. It
 * must not discard them and try to reconstruct a weaker answer from live
 * source text.
 */
export const test_details_consume_snapshot_identity_facts = async () => {
  const dump: ISamchonGraphDump = {
    project: "/snapshot-facts",
    languages: ["typescript"],
    indexer: "lsp",
    nodes: [
      {
        id: "src/a.ts#State:enum",
        kind: "enum",
        language: "typescript",
        name: "State",
        file: "src/a.ts",
        external: false,
        literals: ['"ready"', '"done"'],
        enumMembers: [
          { name: "Ready", value: '"ready"' },
          { name: "Computed" },
        ],
      },
      {
        id: "src/a.ts#service:variable",
        kind: "variable",
        language: "typescript",
        name: "service",
        file: "src/a.ts",
        external: false,
        objectMembers: [
          {
            name: "execute",
            kind: "method",
            line: 8,
            signature: "execute(input: Input): Output",
          },
          { name: "label", kind: "property", line: 12 },
        ],
      },
    ],
    edges: [],
  };
  const app = new SamchonGraphApplication(SamchonGraphMemory.from(dump));
  const output = await app.inspect_code_graph({
    question: "What are State and service?",
    draft: { reason: "Inspect both identity-bearing nodes.", type: "details" },
    review: "Use their exact handles.",
    request: { type: "details", handles: ["State", "service"] },
  });
  const result = output.result as ISamchonGraphDetails;

  TestValidator.equals("enum literals come from the snapshot", result.nodes[0]?.literals, [
    '"ready"',
    '"done"',
  ]);
  TestValidator.equals("enum members keep names and values", result.nodes[0]?.members, [
    { name: "State.Ready", kind: "property", signature: 'Ready = "ready"' },
    { name: "State.Computed", kind: "property" },
  ]);
  TestValidator.equals("object members keep compiler-owned outlines", result.nodes[1]?.members, [
    {
      name: "execute",
      kind: "method",
      line: 8,
      signature: "execute(input: Input): Output",
    },
    { name: "label", kind: "property", line: 12 },
  ]);
  TestValidator.predicate(
    "details audit describes complete identity and sliced fan-out separately",
    output.audit.includes("What a symbol is") &&
      output.audit.includes("short orientation slice") &&
      !output.audit.includes("`truncated` marks it"),
  );
};
