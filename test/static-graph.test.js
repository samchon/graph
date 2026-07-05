const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  GraphMemory,
  SamchonGraphApplication,
  buildGraphDump,
} = require("../lib");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "src", "service.ts"),
    [
      "export class OrderService {",
      "  create(input: CreateOrder): Order {",
      "    return makeOrder(input);",
      "  }",
      "}",
      "export interface CreateOrder { id: string }",
      "export type Order = { id: string }",
      "export function makeOrder(input: CreateOrder): Order {",
      "  return { id: input.id };",
      "}",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(root, "src", "main.go"),
    [
      "package main",
      "type Repository struct{}",
      "func LoadOrder() string {",
      "  return FormatOrder()",
      "}",
      "func FormatOrder() string {",
      "  return \"ok\"",
      "}",
    ].join("\n"),
  );
  return root;
}

test("static graph indexes declarations and approximate dependencies", async () => {
  const root = fixture();
  const dump = await buildGraphDump({ cwd: root, mode: "static" });

  assert.equal(dump.indexer, "static");
  assert.deepEqual(new Set(dump.languages), new Set(["typescript", "go"]));
  assert.ok(dump.nodes.some((node) => node.name === "OrderService"));
  assert.ok(dump.nodes.some((node) => node.name === "LoadOrder"));
  assert.ok(
    dump.edges.some(
      (edge) =>
        (edge.kind === "calls" || edge.kind === "type_ref") &&
        edge.from.includes("OrderService"),
    ),
  );
});

test("application lookup details and tour use the resident graph", async () => {
  const root = fixture();
  const graph = GraphMemory.from(await buildGraphDump({ cwd: root, mode: "static" }));
  const app = new SamchonGraphApplication(graph);

  const lookup = await app.inspect_code_graph({
    question: "Find OrderService",
    draft: { reason: "Named symbol lookup is smallest.", type: "lookup" },
    review: "Lookup is appropriate.",
    request: { type: "lookup", query: "OrderService" },
  });
  assert.equal(lookup.result.type, "lookup");
  assert.ok(lookup.result.hits.some((hit) => hit.name === "OrderService"));

  const details = await app.inspect_code_graph({
    question: "Show OrderService shape",
    draft: { reason: "Selected symbol shape needs details.", type: "details" },
    review: "Details is appropriate.",
    request: { type: "details", handles: ["OrderService"], neighbors: true },
  });
  assert.equal(details.result.type, "details");
  assert.equal(details.result.nodes[0].name, "OrderService");

  const tour = await app.inspect_code_graph({
    question: "How does order creation work?",
    draft: { reason: "Broad flow needs a tour.", type: "tour" },
    review: "Tour is appropriate.",
    request: { type: "tour", question: "order creation" },
  });
  assert.equal(tour.result.type, "tour");
  assert.ok(tour.result.entrypoints.length > 0);
});

test("CLI dump prints graph JSON", () => {
  const root = fixture();
  const output = execFileSync(
    process.execPath,
    [path.join(__dirname, "..", "lib", "bin.js"), "dump", "--mode", "static", "--cwd", root],
    { encoding: "utf8" },
  );
  const dump = JSON.parse(output);
  assert.equal(dump.indexer, "static");
  assert.ok(dump.nodes.length > 0);
});
