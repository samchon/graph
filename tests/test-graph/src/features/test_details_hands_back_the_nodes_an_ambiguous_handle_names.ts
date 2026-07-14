import { TestValidator } from "@nestia/e2e";
import { SamchonGraphApplication, SamchonGraphMemory } from "@samchon/graph";
import type { ISamchonGraphDetails, ISamchonGraphDump } from "@samchon/graph";

/**
 * A name the graph knows twice is not a name the graph does not know.
 *
 * Two classes called `Workbench` are two facts, and answering "unknown" to a
 * handle the checker resolved twice sends the caller to the files for what is
 * already in the index. So `details` hands back the nodes the handle named, each
 * with the id to re-call on, and `next` says to make exactly that one request.
 *
 * The candidates arrive ranked by what the package publishes, then by how much of
 * the codebase leans on the node, with test and fixture declarations last: an
 * unranked list hands back whichever declaration the graph happened to visit
 * first, and a caller that trusts the order inspects the wrong one.
 */
export const test_details_hands_back_the_nodes_an_ambiguous_handle_names =
  async () => {
    const app = new SamchonGraphApplication(SamchonGraphMemory.from(dump()));

    const output = await app.inspect_code_graph({
      question: "What is Workbench?",
      draft: { reason: "One named symbol.", type: "details" },
      review: "Details.",
      request: { type: "details", handles: ["Workbench"] },
    });
    const details = output.result as ISamchonGraphDetails;

    TestValidator.equals(
      "an ambiguous handle is not an unknown handle",
      details.unknown,
      [],
    );
    TestValidator.equals(
      "the nodes it names come back, with the id to re-call on",
      details.ambiguous?.[0]?.candidates.map((candidate) => candidate.id),
      [
        "src/workbench.ts#Workbench:class",
        "test/workbench.spec.ts#Workbench:class",
      ],
    );
    TestValidator.equals(
      "and next names the one request that resolves it",
      output.next.action,
      "inspect",
    );
    TestValidator.equals("which is details again", output.next.request, "details");

    // Re-calling with the id the caller means answers from the index, and the
    // handle that resolves to nothing is still reported as unknown beside it.
    const resolved = await app.inspect_code_graph({
      question: "What is the production Workbench?",
      draft: { reason: "The id disambiguates it.", type: "details" },
      review: "Details by id.",
      request: {
        type: "details",
        handles: ["src/workbench.ts#Workbench:class", "NoSuchSymbol"],
      },
    });
    const second = resolved.result as ISamchonGraphDetails;
    TestValidator.equals(
      "the id resolves to exactly one node",
      second.nodes.map((node) => node.id),
      ["src/workbench.ts#Workbench:class"],
    );
    TestValidator.equals(
      "a handle the graph holds no node for is still unknown",
      second.unknown,
      ["NoSuchSymbol"],
    );
    TestValidator.equals(
      "a result that answered is the whole answer",
      resolved.next.action,
      "answer",
    );
  };

/**
 * The production `Workbench` is what the package publishes and what the codebase
 * leans on; the other is a fixture declaration in a spec file.
 */
const dump = (): ISamchonGraphDump => ({
  project: "/workbench",
  languages: ["typescript"],
  indexer: "static",
  nodes: [
    {
      id: "src/workbench.ts#Workbench:class",
      kind: "class",
      language: "typescript",
      name: "Workbench",
      file: "src/workbench.ts",
      external: false,
      exported: true,
      evidence: { startLine: 1, endLine: 20 },
    },
    {
      id: "test/workbench.spec.ts#Workbench:class",
      kind: "class",
      language: "typescript",
      name: "Workbench",
      file: "test/workbench.spec.ts",
      external: false,
      evidence: { startLine: 1, endLine: 3 },
    },
    {
      id: "src/app.ts#boot:function",
      kind: "function",
      language: "typescript",
      name: "boot",
      file: "src/app.ts",
      external: false,
      exported: true,
      evidence: { startLine: 1, endLine: 3 },
    },
  ],
  edges: [
    { from: "src/index.ts", to: "src/workbench.ts#Workbench:class", kind: "exports" },
    { from: "src/workbench.ts", to: "src/workbench.ts#Workbench:class", kind: "exports" },
    {
      from: "src/app.ts#boot:function",
      to: "src/workbench.ts#Workbench:class",
      kind: "instantiates",
      evidence: { startLine: 2 },
    },
  ],
});
