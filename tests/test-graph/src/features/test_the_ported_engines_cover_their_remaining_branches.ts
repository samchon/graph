import { TestValidator } from "@nestia/e2e";
import {
  buildGraphDump,
  SamchonGraphApplication,
  SamchonGraphMemory,
} from "@samchon/graph";
import type {
  ISamchonGraphDetails,
  ISamchonGraphDump,
  ISamchonGraphEntrypoints,
  ISamchonGraphTour,
  ISamchonGraphTrace,
} from "@samchon/graph";
import fs from "node:fs";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";

/**
 * The branches of the ported engines a behavioural test does not reach on its
 * own: the handle forms, the reference groups, the wire's optional file, and the
 * re-export syntax of each language that has one.
 */
export const test_the_ported_engines_cover_their_remaining_branches = async () => {
  await scenario_every_handle_form_the_resolver_answers();
  await scenario_details_reports_what_implements_a_declaration();
  await scenario_a_doc_comment_says_what_a_symbol_is_for();
  await scenario_an_implementation_span_keeps_the_file_it_cannot_derive();
  await scenario_the_reexport_forms_each_language_writes();
  await scenario_a_module_specifier_that_names_nothing_in_the_project();
  await scenario_an_entrypoint_mention_the_project_declares_twice();
  await scenario_a_tour_of_a_graph_with_no_centre();
};

/**
 * §3b: a model writes a handle the way the result it is remembering read. Every
 * one of these forms means one node, and every one of them used to miss.
 */
const scenario_every_handle_form_the_resolver_answers = async () => {
  const app = new SamchonGraphApplication(SamchonGraphMemory.from(shapesDump()));
  const startOf = async (from: string): Promise<string | undefined> =>
    (
      (
        await app.inspect_code_graph({
          question: `trace ${from}`,
          draft: { reason: "One trace.", type: "trace" },
          review: "Trace.",
          request: { type: "trace", from },
        })
      ).result as ISamchonGraphTrace
    ).start?.id;

  TestValidator.equals(
    "a node id resolves to itself",
    await startOf("src/zod.ts#ZodType.parse:method"),
    "src/zod.ts#ZodType.parse:method",
  );
  TestValidator.equals(
    "an owner-qualified name resolves",
    await startOf("ZodType.parse"),
    "src/zod.ts#ZodType.parse:method",
  );
  // `db.query`, `app.listen`, `repo.save`, `this.store.commit` are all one shape:
  // a method call written on a *value*, not on the type that declares it. There
  // is no `store` in the graph, so every exact form misses, and the last segment
  // is the member it means.
  TestValidator.equals(
    "a member written on a value resolves to the member",
    await startOf("this.store.commit"),
    "src/store.ts#Store.commit:method",
  );
  // A `file#symbol` id whose file is one refactor stale: the graph knows the
  // symbol, so it answers rather than sending the caller back through a lookup.
  TestValidator.equals(
    "a stale id still names its symbol",
    await startOf("src/moved.ts#refine:function"),
    "src/zod.ts#refine:function",
  );
  // `.suffix` against a qualified name, when the graph declares exactly one.
  TestValidator.equals(
    "a dotted suffix resolves against the qualified name",
    await startOf("Inner.only"),
    "src/zod.ts#Outer.Inner.only:method",
  );

  // A member several classes declare comes back as a list, ranked: `schema.parse`
  // means one of them, and the graph does not get to decide which.
  const memberOnValue = await app.inspect_code_graph({
    question: "trace schema.parse",
    draft: { reason: "One trace.", type: "trace" },
    review: "Trace.",
    request: { type: "trace", from: "schema.parse" },
  });
  TestValidator.predicate(
    "a member several classes declare comes back as ranked candidates",
    (memberOnValue.result as ISamchonGraphTrace).candidates?.some(
      (candidate) => candidate.id === "src/zod.ts#ZodType.parse:method",
    ) === true,
  );

  // A `.suffix` the graph declares more than once comes back as candidates, and
  // the trace asks the caller to restate it.
  const ambiguousSuffix = await app.inspect_code_graph({
    question: "trace an ambiguous suffix",
    draft: { reason: "One trace.", type: "trace" },
    review: "Trace.",
    request: { type: "trace", from: "Shared.run" },
  });
  TestValidator.equals(
    "an ambiguous dotted suffix returns its candidates",
    (ambiguousSuffix.result as ISamchonGraphTrace).candidates?.length,
    2,
  );
  TestValidator.equals(
    "and asks the caller to restate it",
    ambiguousSuffix.next.action,
    "clarify",
  );

  // The candidates are ranked by what the package publishes, then by how much of
  // the codebase leans on the node, with test declarations last.
  const ambiguousName = await app.inspect_code_graph({
    question: "trace an ambiguous name",
    draft: { reason: "One trace.", type: "trace" },
    review: "Trace.",
    request: { type: "trace", from: "render" },
  });
  TestValidator.equals(
    "the published declaration is the first reading",
    (ambiguousName.result as ISamchonGraphTrace).candidates?.[0]?.file,
    "src/renderer.ts",
  );
};

/**
 * §3a's other half: a caller that actually wants the list of implementors asks
 * `details`, and gets it — which is why a trace past the hub cut can refuse to
 * dump them into a flow.
 */
const scenario_details_reports_what_implements_a_declaration = async () => {
  const app = new SamchonGraphApplication(SamchonGraphMemory.from(shapesDump()));
  const output = await app.inspect_code_graph({
    question: "What implements the parser?",
    draft: { reason: "Details answers implementedBy.", type: "details" },
    review: "Details.",
    request: {
      type: "details",
      handles: ["src/zod.ts#Parser.parse:method"],
      neighbors: true,
      dependencyLimit: 4,
      neighborLimit: 3,
    },
  });
  const node = (output.result as ISamchonGraphDetails).nodes[0];
  TestValidator.equals(
    "details names the concrete node that implements the declaration",
    node?.implementedBy?.map((ref) => ref.name),
    ["ZodType.parse"],
  );
  // `calls` is what it runs, `types` what it is declared against, and a neighbour
  // is listed once per group.
  TestValidator.predicate(
    "details separates what a symbol runs from what it names in a type position",
    (node?.calls?.length ?? 0) === 0 && (node?.types?.length ?? 0) === 0,
  );
  TestValidator.predicate(
    "and reports who depends on it",
    (node?.dependedOnBy?.length ?? 0) > 0,
  );
};

/**
 * A name and an arrow say what calls what; the doc comment says why, which is
 * what a tour is asked for. The project already wrote that sentence above the
 * declaration.
 */
const scenario_a_doc_comment_says_what_a_symbol_is_for = async () => {
  const root = GraphPaths.createTempDirectory("samchon-graph-doc-");
  write(root, "src/doc.ts", [
    "/**",
    " * Drains the queue until it is empty. The rest of the comment is the file's",
    " * to keep.",
    " *",
    " * @param limit how many to take",
    " */",
    "export function drainQueue(limit: number): void {}",
    "",
    "/* Not a doc comment. */",
    "export function notDocumented(): void {}",
    "",
    "// A line comment is not a doc comment either.",
    "export function alsoNotDocumented(): void {}",
    "",
    "export function undocumented(): void {}",
  ]);
  const app = new SamchonGraphApplication(
    SamchonGraphMemory.from(
      await buildGraphDump({ cwd: root, mode: "static", languages: ["typescript"] }),
    ),
  );
  const details = (
    await app.inspect_code_graph({
      question: "what do these do",
      draft: { reason: "Details.", type: "details" },
      review: "Details.",
      request: {
        type: "details",
        handles: ["drainQueue", "notDocumented", "alsoNotDocumented", "undocumented"],
      },
    })
  ).result as ISamchonGraphDetails;
  const docOf = (name: string): string | undefined =>
    details.nodes.find((node) => node.name === name)?.doc;

  TestValidator.equals(
    "the doc is the first sentence, and the tag list is the file's to keep",
    docOf("drainQueue"),
    "Drains the queue until it is empty.",
  );
  TestValidator.equals(
    "a plain block comment is not documentation",
    docOf("notDocumented"),
    undefined,
  );
  TestValidator.equals(
    "and neither is a line comment",
    docOf("alsoNotDocumented"),
    undefined,
  );
  TestValidator.equals(
    "a declaration with nothing above it has no doc",
    docOf("undocumented"),
    undefined,
  );
};

/**
 * §6b: a span drops the file the reader can reconstruct — but an implementation
 * genuinely can live in another file from the declaration that owns it, so that
 * one is not derivable and keeps its file.
 */
const scenario_an_implementation_span_keeps_the_file_it_cannot_derive = () => {
  const dump: ISamchonGraphDump = {
    project: "/impl",
    languages: ["typescript"],
    indexer: "static",
    nodes: [
      {
        id: "src/decl.ts#handler:variable",
        kind: "variable",
        language: "typescript",
        name: "handler",
        file: "src/decl.ts",
        external: false,
        exported: true,
        evidence: { startLine: 1 },
        // Assigned in another file: the loader cannot derive this file from the
        // node's own, so the wire keeps it.
        implementation: { file: "src/impl.ts", startLine: 9, endLine: 12 },
      },
    ],
    // An `exports` edge whose target the dump never declared: the loader still
    // gives the barrel a file node, and has no language to take from the target.
    edges: [{ from: "src/index.ts", to: "src/gone.ts#ghost:function", kind: "exports" }],
  };
  const graph = SamchonGraphMemory.from(dump);
  const node = graph.node("src/decl.ts#handler:variable");
  TestValidator.equals(
    "the loader puts the declaration's own file back",
    node?.evidence?.file,
    "src/decl.ts",
  );
  TestValidator.equals(
    "and leaves the implementation's file alone, because it could not be derived",
    node?.implementation?.file,
    "src/impl.ts",
  );
  TestValidator.predicate(
    "a barrel that publishes a symbol the dump does not hold is still a file node",
    graph.node("src/index.ts")?.kind === "file",
  );
};

/** Every re-export form the three barrel languages actually write. */
const scenario_the_reexport_forms_each_language_writes = async () => {
  const python = GraphPaths.createTempDirectory("samchon-graph-py2-");
  write(python, "pkg/sale.py", ["class Sale:", "    pass", "class _Hidden:", "    pass"]);
  // A star import in a package initializer forwards the module's whole surface.
  write(python, "pkg/__init__.py", ["from .sale import *"]);
  const pyDump = await buildGraphDump({
    cwd: python,
    mode: "static",
    languages: ["python"],
  });
  TestValidator.predicate(
    "a python star import forwards the module's whole surface",
    pyDump.edges.some(
      (edge) => edge.kind === "exports" && edge.from === "pkg/__init__.py",
    ),
  );
  TestValidator.equals(
    "and privacy is a leading underscore, which means the same in every language",
    pyDump.edges.filter(
      (edge) => edge.kind === "exports" && edge.to.endsWith("#_Hidden:class"),
    ),
    [],
  );

  const rust = GraphPaths.createTempDirectory("samchon-graph-rs2-");
  write(rust, "src/order/mod.rs", ["pub struct Order {}", "pub struct Line {}"]);
  write(rust, "src/lib.rs", [
    // A braced group forwards each name in it.
    "pub use crate::order::{Order, Line};",
    // A `self::` path is relative to the declaring module.
    "pub use self::order::Order as Reordered;",
    // A path with no `::` names no module and forwards nothing.
    "pub use something;",
  ]);
  const rsDump = await buildGraphDump({ cwd: rust, mode: "static", languages: ["rust"] });
  TestValidator.predicate(
    "a rust braced re-export forwards each name in the group",
    rsDump.edges.some(
      (edge) =>
        edge.kind === "exports" &&
        edge.from === "src/lib.rs" &&
        edge.to === "src/order/mod.rs#Line:class",
    ),
  );
};

/**
 * Only a re-export chain that stays inside the project can add a module to a
 * project symbol's wire, so a bare package specifier resolves to nothing and
 * costs the surface count nothing.
 */
const scenario_a_module_specifier_that_names_nothing_in_the_project = async () => {
  const root = GraphPaths.createTempDirectory("samchon-graph-outside-");
  write(root, "src/index.ts", [
    'export * from "typia";',
    'export * from "./missing";',
    'export { nothing } from "./also-missing";',
    "export function present(): void {}",
  ]);
  const dump = await buildGraphDump({ cwd: root, mode: "static", languages: ["typescript"] });
  TestValidator.equals(
    "a specifier that names nothing in the project adds nothing to the wire",
    dump.edges
      .filter((edge) => edge.kind === "exports")
      .map((edge) => edge.to),
    ["src/index.ts#present:function"],
  );
};

/**
 * A mention the project declares twice comes back as candidates, and the tour
 * takes the first reading — the one the package publishes — because a name the
 * project declares more than once is not a name the project does not declare.
 */
const scenario_an_entrypoint_mention_the_project_declares_twice = async () => {
  const app = new SamchonGraphApplication(SamchonGraphMemory.from(shapesDump()));
  const entry = (
    await app.inspect_code_graph({
      question: "how does `render` reach the DOM",
      draft: { reason: "First-pass handles.", type: "entrypoints" },
      review: "Entrypoints.",
      request: { type: "entrypoints", query: "how does `render` reach the DOM", neighbors: 2 },
    })
  ).result as ISamchonGraphEntrypoints;
  TestValidator.predicate(
    "an ambiguous mention hands back the nodes it named",
    (entry.mentions.find((mention) => mention.handle === "render")?.candidates
      ?.length ?? 0) >= 2,
  );

  // A tour of the same question seeds the first reading rather than dropping it.
  const tour = (
    await app.inspect_code_graph({
      question: "how does `render` reach the DOM",
      draft: { reason: "Orientation.", type: "tour" },
      review: "Tour.",
      request: { type: "tour", reinterpretations: [] },
    })
  ).result as ISamchonGraphTour;
  TestValidator.predicate(
    "and the tour opens on the reading the package publishes",
    tour.entrypoints.some((node) => node.file === "src/renderer.ts"),
  );
};

/**
 * A graph nothing publishes has no centre to rank, so every seed scores zero and
 * the tour falls back to the hits the query itself found.
 */
const scenario_a_tour_of_a_graph_with_no_centre = async () => {
  const dump: ISamchonGraphDump = {
    project: "/nocentre",
    languages: ["typescript"],
    indexer: "static",
    nodes: [
      {
        id: "src/only.ts#onlyOne:function",
        kind: "function",
        language: "typescript",
        name: "onlyOne",
        file: "src/only.ts",
        external: false,
        evidence: { startLine: 1, endLine: 2 },
      },
    ],
    edges: [],
  };
  const app = new SamchonGraphApplication(SamchonGraphMemory.from(dump));
  const tour = (
    await app.inspect_code_graph({
      question: "onlyOne",
      draft: { reason: "Orientation.", type: "tour" },
      review: "Tour.",
      request: { type: "tour", reinterpretations: ["onlyOne"] },
    })
  ).result as ISamchonGraphTour;
  TestValidator.predicate(
    "a graph with no export surface still returns the seed the question names",
    tour.entrypoints.some((node) => node.name === "onlyOne"),
  );
  TestValidator.equals("and no flow, because nothing runs", tour.primaryFlow, []);
};

/**
 * A graph shaped to hold every handle form at once: a published class member, a
 * declaration two implementations satisfy, a name two files declare, and a
 * doubly-nested member.
 */
const shapesDump = (): ISamchonGraphDump => ({
  project: "/shapes",
  languages: ["typescript"],
  indexer: "static",
  nodes: [
    member("src/zod.ts#ZodType:class", "class", "ZodType", undefined, 1),
    member("src/zod.ts#ZodType.parse:method", "method", "parse", "ZodType.parse", 2),
    member("src/zod.ts#Parser.parse:method", "method", "parse", "Parser.parse", 8),
    member("src/zod.ts#refine:function", "function", "refine", undefined, 12),
    member("src/zod.ts#Outer.Inner.only:method", "method", "only", "Outer.Inner.only", 16),
    // A member exactly one class declares: `this.store.commit` means this one.
    member("src/store.ts#Store.commit:method", "method", "commit", "Store.commit", 4),
    // `Shared.run` in two files: an ambiguous dotted suffix.
    member("src/a.ts#Shared.run:method", "method", "run", "Shared.run", 1),
    member("src/b.ts#Shared.run:method", "method", "run", "Shared.run", 1),
    // `render` in two files: the published one, and a test fixture's.
    member("src/renderer.ts#render:function", "function", "render", undefined, 1, true),
    member("test/render.spec.ts#render:function", "function", "render", undefined, 1),
    member("src/app.ts#boot:function", "function", "boot", undefined, 1, true),
  ],
  edges: [
    exportsOf("src/index.ts", "src/renderer.ts#render:function"),
    exportsOf("src/renderer.ts", "src/renderer.ts#render:function"),
    exportsOf("src/app.ts", "src/app.ts#boot:function"),
    // The implementation of a body-less declaration, and a caller that leans on it.
    {
      from: "src/zod.ts#ZodType.parse:method",
      to: "src/zod.ts#Parser.parse:method",
      kind: "implements",
      evidence: { startLine: 2 },
    },
    {
      from: "src/app.ts#boot:function",
      to: "src/zod.ts#Parser.parse:method",
      kind: "calls",
      evidence: { startLine: 2 },
    },
    {
      from: "src/app.ts#boot:function",
      to: "src/renderer.ts#render:function",
      kind: "calls",
      evidence: { startLine: 3 },
    },
  ],
});

const member = (
  id: string,
  kind: string,
  name: string,
  qualifiedName: string | undefined,
  line: number,
  exported = false,
) => ({
  id,
  kind: kind as "method",
  language: "typescript" as const,
  name,
  ...(qualifiedName !== undefined ? { qualifiedName } : {}),
  file: id.slice(0, id.indexOf("#")),
  external: false,
  ...(exported ? { exported: true } : {}),
  evidence: { startLine: line, endLine: line + 2 },
});

const exportsOf = (from: string, to: string) => ({
  from,
  to,
  kind: "exports" as const,
});

const write = (root: string, file: string, lines: string[]): void => {
  const abs = path.join(root, file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${lines.join("\n")}\n`);
};
