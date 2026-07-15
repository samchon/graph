import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";

import { GraphFixtures } from "../internal/GraphFixtures";
import { GraphPaths } from "../internal/GraphPaths";

export const test_lsp_mode_advances_reference_ranges_past_trivia = async () => {
  const root = GraphFixtures.createTriviaFixture();
  const dump = await buildGraphDump({
    cwd: root,
    mode: "lsp",
    languages: ["typescript"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer, "--trivia"],
  });

  const edge = (toContains: string) =>
    dump.edges.find((e) => e.to.includes(toContains) && !e.from.endsWith(`#${toContains}`));

  // `new Store` — the keyword directly before the name (once trivia is
  // skipped) marks an instantiation even though the `(` follows the generic-
  // free call on the same line.
  TestValidator.equals(
    "new-expression instantiates",
    edge("Store:class")?.kind,
    "instantiates",
  );
  // The typeof-query reference to Store is a type reference, not an access.
  TestValidator.predicate(
    "typeof query is a type reference",
    dump.edges.some((e) => e.to.includes("Store:class") && e.kind === "type_ref"),
  );

  // A reference whose range starts inside a `/* */` block comment resolves to
  // the token after it: the edge is a call and its evidence points at the
  // token's own line/column, not the comment's.
  const block = edge("blockFn");
  TestValidator.equals("block-comment reference is a call", block?.kind, "calls");
  TestValidator.equals(
    "block-comment reference evidence lands on the token line",
    block?.evidence?.startLine,
    4,
  );

  // A reference whose range starts on a `//` line-comment line advances across
  // the comment and the following newline to the token on the next line.
  const lineRef = edge("lineFn");
  TestValidator.equals("line-comment reference is a call", lineRef?.kind, "calls");
  TestValidator.equals(
    "line-comment reference evidence lands on the wrapped token line",
    lineRef?.evidence?.startLine,
    7,
  );

  // A namespaced JSX tag `<NS.Panel />` renders the component AND, because the
  // tag name is a member-access chain, accesses the same target.
  const panelKinds = new Set(
    dump.edges.filter((e) => e.to.includes("Panel")).map((e) => e.kind),
  );
  TestValidator.predicate(
    "a namespaced JSX tag emits both a render and an access",
    panelKinds.has("renders") && panelKinds.has("accesses"),
  );

  // An optional call `optFn?.()` invokes the target through optional chaining.
  TestValidator.equals("optional call is a call", edge("optFn")?.kind, "calls");

  // §2j, in the language-server lane. `register(passedFn);` is a top-level
  // statement, so what it does belongs to the module — the file node every
  // top-level declaration already hangs off — and `passedFn` sits in an argument
  // list with no `(` of its own, so the site that hands it over is what invokes
  // it. Without either, a module's own wiring is attributed to nobody and the
  // codebase reads back as a set of disconnected islands.
  const moduleScoped = dump.edges.filter(
    (e) => e.from === "src/trivia.ts" && e.kind === "calls",
  );
  TestValidator.predicate(
    "a call written at the top level of a module belongs to the module",
    moduleScoped.some((e) => e.to.endsWith("#register:function")),
  );
  TestValidator.predicate(
    "a callable passed as a value gets the call edge that says so",
    moduleScoped.some((e) => e.to.endsWith("#passedFn:function")),
  );
};
