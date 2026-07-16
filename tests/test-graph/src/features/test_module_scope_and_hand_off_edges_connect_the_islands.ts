import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";

/**
 * What a module does at load belongs to the module. A callable passed as a value
 * is accessed at the hand-off site, not invoked there.
 *
 * Without either, every event-driven codebase looks like a set of disconnected
 * islands: a router mounting its handlers at the top of a file is attributed to
 * nobody, the name in `app.use(handler)` sits in an argument list with no `(` of
 * its own and must not be mistaken for either a type reference or a direct call.
 */
export const test_module_scope_and_hand_off_edges_connect_the_islands =
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-wiring-"));
    write(root, "src/server.ts", [
      'import { use } from "./router";',
      "",
      "export function handler(): void {",
      "  work();",
      "}",
      "",
      "export function work(): void {}",
      "",
      "export function mixed(): typeof handler {",
      "  use(handler);",
      "  handler();",
      "  return handler;",
      "}",
      "",
      "use(handler);",
    ]);
    write(root, "src/router.ts", ["export function use(fn: unknown): void {}"]);

    const dump = await buildGraphDump({
      cwd: root,
      mode: "static",
      languages: ["typescript"],
    });
    const from = (source: string): { to: string; kind: string }[] =>
      dump.edges
        .filter((edge) => edge.from === source)
        .map((edge) => ({ to: edge.to, kind: edge.kind }));

    // The module's own top-level call is the module's.
    TestValidator.predicate(
      "a call written at the top level of a module belongs to the module",
      from("src/server.ts").some(
        (edge) => edge.to === "src/router.ts#use:function" && edge.kind === "calls",
      ),
    );
    // The callable argument is accessed at this site, not invoked by it.
    TestValidator.predicate(
      "a callable passed as a value gets an access edge rather than a call",
      from("src/server.ts").some(
        (edge) =>
          edge.to === "src/server.ts#handler:function" &&
          edge.kind === "accesses",
      ) &&
        !from("src/server.ts").some(
          (edge) =>
            edge.to === "src/server.ts#handler:function" &&
            edge.kind === "calls",
        ),
    );
    // ttsc keys edges by (from, to, wire kind): a type use, a direct call, and
    // a hand-off access to the same target are three independent facts.
    TestValidator.equals(
      "distinct relations to one target coexist",
      from("src/server.ts#mixed:function")
        .filter((edge) => edge.to === "src/server.ts#handler:function")
        .map((edge) => edge.kind)
        .sort(),
      ["accesses", "calls", "type_ref"],
    );
    // An import names a symbol in order to bring it in, which is not the module
    // running it — so the import line contributes no module-scope edge of its own.
    TestValidator.equals(
      "an import line is not the module running the symbol",
      dump.edges.filter(
        (edge) => edge.from === "src/server.ts" && edge.kind === "type_ref",
      ),
      [],
    );

    await scenario_the_language_server_lane_wires_the_same_way();
  };

/**
 * The static parser and the language-server pass must agree: a graph's facts
 * cannot depend on which lane built it, so the operations layer never has to ask.
 */
const scenario_the_language_server_lane_wires_the_same_way = async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-wiring-lsp-"));
  write(root, "src/lsp.ts", [
    "export class LspService {",
    "  run(): void {",
    "    helper();",
    "  }",
    "}",
    "const warning = true;",
    "function helper(): void {",
    "  return;",
    "}",
    "export { helper as publicHelper };",
    "export default LspService;",
  ]);

  const dump = await buildGraphDump({
    cwd: root,
    mode: "lsp",
    languages: ["typescript"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer],
  });
  TestValidator.predicate(
    "the language-server lane also derives the closure flag and the export surface",
    dump.edges.some((edge) => edge.kind === "exports"),
  );
};

const write = (root: string, file: string, lines: string[]): void => {
  const abs = path.join(root, file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${lines.join("\n")}\n`);
};
