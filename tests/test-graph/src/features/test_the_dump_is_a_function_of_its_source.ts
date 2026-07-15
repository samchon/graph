import { TestValidator } from "@nestia/e2e";
import { buildGraphDump, SamchonGraphMemory } from "@samchon/graph";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Two dumps of the same unedited checkout are the same dump.
 *
 * A graph whose ids or contents move under an identical source cannot be cached,
 * diffed, or trusted — and nothing in a token benchmark would ever tell you.
 * Building VS Code's graph twice gave `@ttsc/graph` dumps that differed by 661
 * nodes and edges, because the checker mangled private class fields with a
 * per-program counter that was reaching the node ids.
 *
 * Nothing in the dump may move under an unchanged source, and that includes a
 * timestamp: `generatedAt` was exactly the field that made byte-identical output
 * impossible to even assert, so it is gone.
 */
export const test_the_dump_is_a_function_of_its_source = async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-determinism-"));
  write(root, "src/order.ts", [
    "export class OrderService {",
    "  #secret = 1;",
    "  create(): number {",
    "    return this.#secret + helper();",
    "  }",
    "}",
    "export function helper(): number {",
    "  return 1;",
    "}",
  ]);
  write(root, "src/index.ts", ['export * from "./order";']);

  const first = await buildGraphDump({ cwd: root, mode: "static", languages: ["typescript"] });
  const second = await buildGraphDump({ cwd: root, mode: "static", languages: ["typescript"] });
  TestValidator.equals(
    "two dumps of one unedited checkout are byte-identical",
    JSON.stringify(first),
    JSON.stringify(second),
  );
  TestValidator.predicate(
    "the dump records nothing that moves on its own",
    !JSON.stringify(first).includes("generatedAt"),
  );

  scenario_a_span_does_not_carry_the_file_the_reader_already_holds(first);
};

/**
 * §6b: a node's declaration span is in the node's own `file`, and an edge's span
 * is in the file its `from` id names — the id is `path#Qualified.Name:kind`. Both
 * rode the wire a second and a third time, on every node and on every edge, and
 * edges outnumber nodes several times over: 17% of the document was a value the
 * reader already held.
 *
 * The loader puts it back before anything reads it, so nothing downstream of it
 * ever sees a span without its file.
 */
const scenario_a_span_does_not_carry_the_file_the_reader_already_holds = (
  dump: Awaited<ReturnType<typeof buildGraphDump>>,
): void => {
  TestValidator.equals(
    "no node's span repeats the file the node already names",
    dump.nodes.filter((node) => node.evidence?.file !== undefined),
    [],
  );
  TestValidator.equals(
    "no edge's span repeats the file its `from` id already names",
    dump.edges.filter((edge) => edge.evidence?.file !== undefined),
    [],
  );

  // A span is coordinates. Nothing else may ride it — least of all the source
  // text inside it, which is the one thing the graph exists not to carry, and
  // which would be paid for on every edge in the document.
  const COORDINATES = ["file", "startLine", "startCol", "endLine", "endCol"];
  const extras = [
    ...dump.nodes.flatMap((node) => [node.evidence, node.implementation]),
    ...dump.edges.map((edge) => edge.evidence),
  ]
    .filter((span) => span !== undefined)
    .flatMap((span) => Object.keys(span))
    .filter((key) => !COORDINATES.includes(key));
  TestValidator.equals("a span carries coordinates and nothing else", extras, []);

  // And the reader gets the whole evidence back, file included.
  const graph = SamchonGraphMemory.from(dump);
  const create = graph.node("src/order.ts#OrderService.create:method");
  TestValidator.equals(
    "the loader puts the node's file back into its span",
    create?.evidence?.file,
    "src/order.ts",
  );
  const call = graph
    .outgoing("src/order.ts#OrderService.create:method")
    .find((edge) => edge.kind === "calls");
  TestValidator.equals(
    "the loader puts the edge's file back into its span",
    call?.evidence?.file,
    "src/order.ts",
  );
};

const write = (root: string, file: string, lines: string[]): void => {
  const abs = path.join(root, file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${lines.join("\n")}\n`);
};
