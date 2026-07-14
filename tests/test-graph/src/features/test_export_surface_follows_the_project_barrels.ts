import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The export surface is a count, not a flag.
 *
 * A module's `exports` edges say which modules put a symbol on the wire, and a
 * barrel forwards what the file below it publishes — so the name a consumer
 * imports from the package carries an edge from every file above it, while an
 * internal helper carries only the one from the file that declares it. That
 * difference is the whole reason the tour's centrality is a product rather than
 * a flag: a ranker that knew only `exported` saw a package's front door and its
 * private helper as equally public.
 *
 * `@ttsc/graph` reads the count off the checker's export table, which has already
 * followed every re-export. With no checker, the links come from the export
 * syntax itself (§4k) and are followed the same way — including a barrel that
 * re-exports a barrel. Degrade per language, not per tour: a language with no
 * re-export form simply has none, and its symbols still carry the edge from the
 * file that declares them.
 */
export const test_export_surface_follows_the_project_barrels = async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-barrel-"));
  write(root, "src/order.ts", [
    "export class OrderService {",
    "  create(): void {}",
    "}",
    "export function orderHelper(): void {}",
    "function privateHelper(): void {}",
  ]);
  // A leaf barrel re-exports the whole module; the package barrel re-exports the
  // leaf barrel and names one symbol explicitly, so `OrderService` is on the wire
  // three times over and `orderHelper` twice.
  write(root, "src/index.ts", ['export * from "./order";']);
  write(root, "index.ts", [
    'export * from "./src/index";',
    'export { OrderService } from "./src/order";',
    // A dependency specifier resolves to nothing inside the project, so it adds
    // no module to any project symbol's wire.
    'export { readFile } from "node:fs";',
  ]);

  const dump = await buildGraphDump({ cwd: root, mode: "static", languages: ["typescript"] });
  const publishers = (id: string): string[] =>
    dump.edges
      .filter((edge) => edge.kind === "exports" && edge.to === id)
      .map((edge) => edge.from)
      .sort();

  TestValidator.equals(
    "a symbol re-exported up two barrels is on the wire from every module above it",
    publishers("src/order.ts#OrderService:class"),
    ["index.ts", "src/index.ts", "src/order.ts"],
  );
  TestValidator.equals(
    "a star re-export forwards what the module below it publishes",
    publishers("src/order.ts#orderHelper:function"),
    ["index.ts", "src/index.ts", "src/order.ts"],
  );
  TestValidator.equals(
    "a symbol the project never exports is on no module's wire",
    publishers("src/order.ts#privateHelper:function"),
    [],
  );
  // A barrel declares nothing, so its only trace in the dump is the edges leaving
  // it — and it is exactly the file a consumer imports the package from, so the
  // loader still gives it a node.
  TestValidator.predicate(
    "a barrel that declares nothing is still a file node",
    dump.edges.some((edge) => edge.kind === "exports" && edge.from === "index.ts"),
  );

  await scenario_named_reexports_forward_only_what_they_name();
  await scenario_python_and_rust_barrels();
  await scenario_a_language_with_no_reexport_form();
  await scenario_a_barrel_cycle_terminates();
};

/**
 * `export { a, b as c } from "./x"` forwards `a` and `b` — the names as the
 * *target* spells them, since the local alias after `as` is this file's name for
 * the symbol, not the one the target declared. Everything else the target
 * publishes stays behind.
 */
const scenario_named_reexports_forward_only_what_they_name = async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-named-"));
  write(root, "src/pair.ts", [
    "export function kept(): void {}",
    "export function renamed(): void {}",
    "export function withheld(): void {}",
  ]);
  write(root, "src/index.ts", [
    'export { kept, renamed as publicName } from "./pair";',
  ]);

  const dump = await buildGraphDump({ cwd: root, mode: "static", languages: ["typescript"] });
  const publishedBy = (file: string): string[] =>
    dump.edges
      .filter((edge) => edge.kind === "exports" && edge.from === file)
      .map((edge) => edge.to.slice(edge.to.indexOf("#") + 1))
      .sort();

  TestValidator.equals(
    "a named re-export forwards the names it names, under the target's spelling",
    publishedBy("src/index.ts"),
    ["kept:function", "renamed:function"],
  );
};

/** Python's barrel is `__init__.py`; Rust's is `pub use`. */
const scenario_python_and_rust_barrels = async () => {
  const python = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-py-"));
  write(python, "pkg/order.py", ["class Order:", "    pass"]);
  write(python, "pkg/__init__.py", ["from .order import Order"]);
  // An ordinary module's imports are imports, not a published surface: only the
  // package initializer counts.
  write(python, "pkg/consumer.py", ["from .order import Order"]);
  const pyDump = await buildGraphDump({ cwd: python, mode: "static", languages: ["python"] });
  const pyPublishers = pyDump.edges
    .filter((edge) => edge.kind === "exports" && edge.to.endsWith("#Order:class"))
    .map((edge) => edge.from)
    .sort();
  TestValidator.equals(
    "a python package initializer publishes what it imports",
    pyPublishers,
    ["pkg/__init__.py", "pkg/order.py"],
  );

  const rust = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-rs-"));
  write(rust, "src/order.rs", ["pub struct Order {}", "pub struct Line {}"]);
  write(rust, "src/lib.rs", [
    "pub use crate::order::Order;",
    "pub use crate::order::*;",
  ]);
  const rsDump = await buildGraphDump({ cwd: rust, mode: "static", languages: ["rust"] });
  const rsPublishers = rsDump.edges
    .filter((edge) => edge.kind === "exports" && edge.to.endsWith("#Line:class"))
    .map((edge) => edge.from)
    .sort();
  TestValidator.equals(
    "a rust glob re-export publishes the module's whole surface",
    rsPublishers,
    ["src/lib.rs", "src/order.rs"],
  );
};

/**
 * Go has no re-export form: a symbol is published by being capitalized, and no
 * second module can put it on the wire. It still carries the edge from the file
 * that declares it, which is what the export surface counts.
 */
const scenario_a_language_with_no_reexport_form = async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-go-"));
  write(root, "order.go", [
    "package order",
    "",
    "func Create() {}",
    "",
    "func internal() {}",
  ]);
  const dump = await buildGraphDump({ cwd: root, mode: "static", languages: ["go"] });
  TestValidator.equals(
    "an exported go symbol is on the wire from the file that declares it",
    dump.edges
      .filter((edge) => edge.kind === "exports" && edge.to.endsWith("#Create:function"))
      .map((edge) => edge.from),
    ["order.go"],
  );
  TestValidator.equals(
    "an unexported one is on no wire",
    dump.edges.filter(
      (edge) => edge.kind === "exports" && edge.to.endsWith("#internal:function"),
    ),
    [],
  );
};

/** Two files that re-export each other is legal, and must not hang the index. */
const scenario_a_barrel_cycle_terminates = async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-cycle-"));
  write(root, "src/a.ts", ["export function fromA(): void {}", 'export * from "./b";']);
  write(root, "src/b.ts", ["export function fromB(): void {}", 'export * from "./a";']);
  const dump = await buildGraphDump({ cwd: root, mode: "static", languages: ["typescript"] });
  TestValidator.predicate(
    "a barrel cycle still resolves an export surface",
    dump.edges.some(
      (edge) => edge.kind === "exports" && edge.to === "src/a.ts#fromA:function",
    ),
  );
};

const write = (root: string, file: string, lines: string[]): void => {
  const abs = path.join(root, file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${lines.join("\n")}\n`);
};
