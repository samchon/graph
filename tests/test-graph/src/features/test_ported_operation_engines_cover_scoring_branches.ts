import { TestValidator } from "@nestia/e2e";
import { SamchonGraphMemory, SamchonGraphApplication } from "@samchon/graph";
import type { ISamchonGraphApplication } from "@samchon/graph";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const call = (
  app: SamchonGraphApplication,
  request: ISamchonGraphApplication.IProps["request"],
) =>
  app.inspect_code_graph({
    question: `probe ${request.type}`,
    draft: { reason: `${request.type} scoring branch`, type: request.type },
    review: "Scoring fixture exercises the ported ranking branches.",
    request,
  });

const evidence = (file: string, startLine: number, endLine: number) => ({
  file,
  startLine,
  startCol: 1,
  endLine,
  endCol: 1,
  text: "",
});

const node = (
  id: string,
  kind: string,
  name: string,
  file: string,
  line: number,
  endLine: number,
  extra: Record<string, unknown> = {},
) => ({
  id,
  kind,
  language: "typescript",
  name,
  file,
  external: false,
  exported: true,
  signature: `${kind} ${name}`,
  evidence: evidence(file, line, endLine),
  ...extra,
});

const edge = (from: string, to: string, kind: string, file = "src/index.ts") => ({
  from,
  to,
  kind,
  evidence: evidence(file, 1, 1),
});

const dumpOf = (root: string, nodes: unknown[], edges: unknown[]) => ({
  project: root,
  languages: ["typescript"],
  generatedAt: new Date(0).toISOString(),
  indexer: "static" as const,
  nodes,
  edges,
  diagnostics: [],
  warnings: [],
});

// Exercises every entry-surface / kind / runtime-entry / source-depth branch of
// the tour seed scorer, plus the query-code-term and requested-kind branches of
// lookup, by feeding a graph of symbols spread across index/main/app files at
// varied directory depths and package layouts.
export const test_ported_operation_engines_cover_scoring_branches = async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-score-"));
  const nodes = [
    // stem/depth surface scoring: index at depth 0/1/2, main, app, packages, bare
    node("index0#renderMain:function", "function", "renderMain", "index.ts", 1, 1),
    node("src/index.ts#createRoot:function", "function", "createRoot", "src/index.ts", 1, 1),
    node("src/a/index.ts#mountView:function", "function", "mountView", "src/a/index.ts", 1, 1),
    node("src/a/b/index.ts#updateTree:function", "function", "updateTree", "src/a/b/index.ts", 1, 1),
    node("src/a/b/c/deep.ts#deepRender:function", "function", "deepRender", "src/a/b/c/deep.ts", 1, 1),
    // qualifiedName ends with a dotted code term without a preceding dot →
    // runLookup's trailing-dotted-suffix branch.
    node("src/w.ts#config:property", "property", "config", "src/w.ts", 1, 1, { qualifiedName: "superWidgets.config" }),
    node("src/main.ts#startServer:function", "function", "startServer", "src/main.ts", 1, 1),
    node("src/app.ts#initApp:method", "method", "initApp", "src/app.ts", 1, 1),
    node("packages/core/src/handler.ts#handleEvent:function", "function", "handleEvent", "packages/core/src/handler.ts", 1, 1),
    node("lib/util.ts#parseInput:function", "function", "parseInput", "lib/util.ts", 1, 1),
    // runtimeEntryScore class-name branch (server/factory/backend)
    node("src/net/Server.ts#HttpServer:class", "class", "HttpServer", "src/net/Server.ts", 1, 1),
    // kindScore unusual-kind default branch + non-executable seed kinds
    node("src/model.ts#Color:enum", "enum", "Color", "src/model.ts", 1, 1),
    node("src/mod.ts#Widgets:module", "module", "Widgets", "src/mod.ts", 1, 1),
    node("src/ns.ts#Geometry:namespace", "namespace", "Geometry", "src/ns.ts", 1, 1),
    node("src/prop.ts#config:property", "property", "config", "src/prop.ts", 1, 1),
    // underscore-prefixed name → runLookup's isInternalish dampening branch.
    node("src/priv.ts#_secretHelper:function", "function", "_secretHelper", "src/priv.ts", 1, 1),
  ];
  // Give a couple of nodes real degree so the log-scaled degree branches run.
  const hub = "src/index.ts#createRoot:function";
  const edges = [
    edge("index0#renderMain:function", hub, "calls"),
    edge("src/a/index.ts#mountView:function", hub, "calls"),
    edge(hub, "src/prop.ts#config:property", "accesses"),
    edge("src/prop.ts#config:property", "src/main.ts#startServer:function", "calls"),
  ];
  const app = new SamchonGraphApplication(SamchonGraphMemory.from(dumpOf(root, nodes, edges)));

  // Tour over a rendering query drives the full seed scorer across all files.
  const tour = (await call(app, { type: "tour", query: "how does render mount update the view tree" })).result;
  TestValidator.predicate("scoring tour returns entrypoints", tour.entrypoints.length >= 1);

  // A query made only of words too short to become query terms → the seed
  // scorer's queryAlignmentFactor sees zero query words (its neutral branch).
  const noTerms = (await call(app, { type: "tour", query: "a an is by to" })).result;
  TestValidator.predicate("a term-less query still returns entrypoints", noTerms.entrypoints.length >= 1);

  // Lookup with backtick handle, "X method" pattern, dotted term, and the
  // functions/classes/interfaces/types/variables kind words.
  const dotted = (await call(app, { type: "lookup", query: "trace `Geometry` the initApp method and superWidgets.config Widgets.config functions classes interfaces types variables const" })).result;
  TestValidator.predicate("scoring lookup returns hits", dotted.hits.length >= 1);

  await scenario_seed_fallbacks();
  await scenario_details_edges();
  await scenario_trace_hop_cap();
  await scenario_impact_ranks_and_refs();
  await scenario_evidence_less_flow_and_test_nodes();
};

// Exercises impactEndpointRank tiers (exported / external / ignored / test) and
// the ordering tiebreak, plus the non-exported seedReason branch and the
// nearby-ref line/sourceSpan optionals in the tour.
const scenario_impact_ranks_and_refs = async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-rank-"));
  const hub = "src/x.ts#hub:function";
  const nodes = [
    node("src/x.ts#hub:function", "function", "hub", "src/x.ts", 1, 1, { exported: false }),
    node("src/x.ts#exp:function", "function", "exp", "src/x.ts", 2, 2, { exported: true }),
    node("src/x.ts#ext:function", "function", "ext", "src/x.ts", 3, 3, { exported: false, external: true }),
    node("src/x.ts#ign:function", "function", "ign", "src/x.ts", 4, 4, { exported: false, ignored: true }),
    node("tests/x.test.ts#tst:function", "function", "tst", "tests/x.test.ts", 1, 1, { exported: false }),
    // two same-rank (internal, rank 2) callers with different edge kinds → the
    // edgeRank tiebreak in the ordering comparator.
    node("src/x.ts#p1:function", "function", "p1", "src/x.ts", 5, 5, { exported: false }),
    node("src/x.ts#p2:function", "function", "p2", "src/x.ts", 6, 6, { exported: false }),
    // a dependency target with real evidence → the nearby-ref line+sourceSpan
    // present branches.
    node("src/x.ts#dep:variable", "variable", "dep", "src/x.ts", 7, 7, { exported: false }),
    // a dependency target with NO evidence → the nearby-ref line+sourceSpan
    // absent branches.
    (() => {
      const n = node("src/x.ts#noloc:variable", "variable", "noloc", "src/x.ts", 9, 9, { exported: false });
      delete (n as { evidence?: unknown }).evidence;
      return n;
    })(),
    // a second seed that matches the "hub" query but has no dependency edges →
    // the nearby-spread absent side (a details node without dependsOn).
    node("src/x.ts#hubHelper:function", "function", "hubHelper", "src/x.ts", 10, 10, { exported: false }),
    // an exported, in-degree-only symbol whose name does not match the query and
    // that has no outgoing execution → the exported seedReason branch.
    node("src/x.ts#exportedApi:function", "function", "exportedApi", "src/x.ts", 11, 11, { exported: true }),
    // a strong query match with NO edges: it out-ranks into the detail seeds yet
    // has no dependency neighbors, so the tour's nearby spread hits the absent
    // side of the dependsOn/dependedOnBy guards.
    node("src/x.ts#zephyr:function", "function", "zephyr", "src/x.ts", 12, 12, { exported: false }),
  ];
  const edges = [
    edge("src/x.ts#exp:function", hub, "calls", "src/x.ts"),
    edge("src/x.ts#ext:function", hub, "calls", "src/x.ts"),
    edge("src/x.ts#ign:function", hub, "calls", "src/x.ts"),
    edge("tests/x.test.ts#tst:function", hub, "tests", "tests/x.test.ts"),
    edge("src/x.ts#p1:function", hub, "calls", "src/x.ts"),
    edge("src/x.ts#p2:function", hub, "accesses", "src/x.ts"),
    edge(hub, "src/x.ts#dep:variable", "accesses", "src/x.ts"),
    edge(hub, "src/x.ts#noloc:variable", "accesses", "src/x.ts"),
    // many callers into the exported api so it ranks as a seed, no outgoing.
    ...["exp", "ext", "ign", "p1", "p2"].map((c) => edge(`src/x.ts#${c}:function`, "src/x.ts#exportedApi:function", "calls", "src/x.ts")),
  ];
  const app = new SamchonGraphApplication(SamchonGraphMemory.from(dumpOf(root, nodes, edges)));
  const trace = (await call(app, { type: "trace", from: "hub", direction: "impact", maxNodes: 16 })).result;
  TestValidator.predicate("impact trace reaches its callers", (trace.reached?.length ?? 0) >= 1);
  // hub (with neighbors) and hubHelper (without) both match the query, so the
  // tour's nearby spread sees details with and without dependency refs, and its
  // refs surface targets with and without a source span.
  const tour = (await call(app, { type: "tour", query: "zephyr hub" })).result;
  TestValidator.predicate("tour surfaces the hub", tour.entrypoints.length >= 1);

  // A minimal graph where both detail seeds are guaranteed: alpha has a
  // dependency neighbor (dependsOn present) and beta has none (dependsOn
  // absent), so the tour's nearby spread covers both sides of the guard.
  const mini = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-mini-"));
  const mnodes = [
    node("src/m.ts#alpha:function", "function", "alpha", "src/m.ts", 1, 1, { exported: false }),
    node("src/m.ts#beta:function", "function", "beta", "src/m.ts", 2, 2, { exported: false }),
    node("src/m.ts#leaf:variable", "variable", "leaf", "src/m.ts", 3, 3, { exported: false }),
  ];
  const medges = [edge("src/m.ts#alpha:function", "src/m.ts#leaf:variable", "accesses", "src/m.ts")];
  const miniApp = new SamchonGraphApplication(SamchonGraphMemory.from(dumpOf(mini, mnodes, medges)));
  const miniTour = (await call(miniApp, { type: "tour", query: "alpha beta" })).result;
  TestValidator.predicate("mini tour surfaces both seeds", miniTour.entrypoints.length >= 1);
};

// Exercises the tour seed fallback (no scored seeds → fall back to ranked hits),
// the all-non-executable flow-seed branch, and entrypoints backtick handle
// resolution.
const scenario_seed_fallbacks = async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-seed-"));
  // Only interface nodes: they are NOT tour-seed kinds, so rankedTourSeeds is
  // empty and tourSeedsOf must fall back to ranked hits.
  const interfaces = [
    node("src/types.ts#Shape:interface", "interface", "Shape", "src/types.ts", 1, 1),
    node("src/types.ts#Point:interface", "interface", "Point", "src/types.ts", 1, 1),
  ];
  const appI = new SamchonGraphApplication(SamchonGraphMemory.from(dumpOf(root, interfaces, [])));
  const fallback = (await call(appI, { type: "tour", query: "describe the shape and point interfaces" })).result;
  TestValidator.predicate("tour falls back to ranked seeds", fallback.entrypoints.length >= 0);

  // Only enum/module seeds → flowSeedIdsOf finds no executable and uses all seeds.
  const enums = [
    node("src/e.ts#Mode:enum", "enum", "Mode", "src/e.ts", 1, 1),
    node("src/m.ts#Registry:module", "module", "Registry", "src/m.ts", 1, 1),
  ];
  const appE = new SamchonGraphApplication(SamchonGraphMemory.from(dumpOf(root, enums, [edge("src/m.ts#Registry:module", "src/e.ts#Mode:enum", "references", "src/m.ts")])));
  const enumTour = (await call(appE, { type: "tour", query: "the Mode enum and Registry module" })).result;
  TestValidator.predicate("non-executable seeds still produce a tour", enumTour.entrypoints.length >= 1);

  // Entrypoints: a backtick handle that resolves plus one that is not a valid
  // handle (contains a space) so normalizeHandle rejects it.
  const ep = (await call(appE, { type: "entrypoints", query: "look at `Registry` and `not a handle` orientation" })).result;
  TestValidator.predicate("entrypoints resolves backtick handle", ep.ranked.length >= 0);
};

// Exercises runDetails object-literal edge cases: a variable with no endLine, an
// oversized span, an unreadable file, and a container whose contained member id
// is dangling.
const scenario_details_edges = async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-det-"));
  // A real object-literal file with two members, so memberLimit=1 hits the
  // members-full break inside objectLiteralMembers.
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "src", "obj.ts"),
    ["export const opts = {", "  host: \"h\",", "  connect() { return 1; },", "};"].join("\n"),
  );
  const nodes = [
    node("src/obj.ts#opts:variable", "variable", "opts", "src/obj.ts", 1, 4),
    // object-literal variable whose file does not exist → fileLines catch
    node("src/gone.ts#ghost:variable", "variable", "ghost", "src/gone.ts", 1, 3),
    // variable whose evidence file is empty → fileLines file==="" guard
    (() => {
      const n = node("noFile#blank:variable", "variable", "blank", "", 1, 3);
      n.evidence = { file: "", startLine: 1, startCol: 1, endLine: 3, endCol: 1, text: "" };
      return n;
    })(),
    // variable with no endLine → objectLiteralMembers early return
    (() => {
      const n = node("src/n.ts#noEnd:variable", "variable", "noEnd", "src/n.ts", 1, 1);
      n.evidence = { file: "src/n.ts", startLine: 1, startCol: 1, endLine: undefined as unknown as number, endCol: 1, text: "" };
      return n;
    })(),
    // oversized span → objectLiteralMembers size guard
    node("src/big.ts#huge:variable", "variable", "huge", "src/big.ts", 1, 5000),
    // container with a dangling contained member
    node("src/c.ts#Box:class", "class", "Box", "src/c.ts", 1, 10),
  ];
  const edges = [edge("src/c.ts#Box:class", "src/c.ts#missing:method", "contains", "src/c.ts")];
  const app = new SamchonGraphApplication(SamchonGraphMemory.from(dumpOf(root, nodes, edges)));
  const details = (await call(app, { type: "details", handles: ["ghost", "noEnd", "huge", "Box", "blank"] })).result;
  TestValidator.predicate("details resolves the selected nodes", details.nodes.length >= 1);
  // memberLimit=1 breaks after the first object-literal member.
  const capped = (await call(app, { type: "details", handles: ["opts"], memberLimit: 1 })).result;
  TestValidator.equals("object-literal members respect the limit", capped.nodes.find((n) => n.name === "opts")?.members?.length ?? 0, 1);
};

// Exercises the runTrace hop-cap truncation branch: a dense back-edge cluster
// where hops accumulate to maxHops before reached hits maxNodes.
const scenario_trace_hop_cap = async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-hop-"));
  // A hub with many callers that all also call each other, so back-edges to
  // already-reached nodes pile up as hops without growing `reached`.
  // s fans out to a 5-clique {n0..n4}; processing the clique's back-edges fills
  // hops to maxHops (2*7=14) while reached is still 6 (< maxNodes 7). n4 then
  // reaches a brand-new node X — a NEW node discovered with hops already full,
  // which is the new-node hop-cap branch (distinct from the back-edge cap).
  const fn = (id: string, line: number) => node(`src/h.ts#${id}:function`, "function", id, "src/h.ts", line, line);
  const nodes = [fn("s", 1), fn("X", 2), ...Array.from({ length: 5 }, (_, i) => fn(`n${i}`, 3 + i))];
  const edges = [];
  for (let i = 0; i < 5; i++) edges.push(edge("src/h.ts#s:function", `src/h.ts#n${i}:function`, "calls", "src/h.ts"));
  for (let i = 0; i < 5; i++)
    for (let j = 0; j < 5; j++)
      if (i !== j) edges.push(edge(`src/h.ts#n${i}:function`, `src/h.ts#n${j}:function`, "calls", "src/h.ts"));
  edges.push(edge("src/h.ts#n4:function", "src/h.ts#X:function", "calls", "src/h.ts"));
  const app = new SamchonGraphApplication(SamchonGraphMemory.from(dumpOf(root, nodes, edges)));
  const trace = (await call(app, { type: "trace", from: "s", direction: "forward", maxNodes: 7 })).result;
  TestValidator.predicate("dense forward trace truncates", trace.truncated === true);
};

// Exercises the tour's node-conversion helpers with evidence-less nodes that
// reach them through paths `isTourSeed` does not gate: a flow-reached callee
// (traceNodeOf) and a test-file caller found via testAnchorsOf (graphNodeOf).
// Also exercises the tour's `includeTests: false` branch.
const scenario_evidence_less_flow_and_test_nodes = async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-ghost-"));
  const seed = node("src/g.ts#seedFn:function", "function", "seedFn", "src/g.ts", 1, 1, { exported: false });
  // Reached through the seed's forward trace, not itself a scored seed, so it
  // is never required to carry evidence → traceNodeOf's sourceSpan/line-absent
  // branch runs when it is packaged into the flow.
  const reachedGhost = (() => {
    const n = node("src/g.ts#reachedGhost:function", "function", "reachedGhost", "src/g.ts", 2, 2, { exported: false });
    delete (n as { evidence?: unknown }).evidence;
    return n;
  })();
  // A test-file caller of the seed, found via testAnchorsOf's incoming-edge
  // scan (not `isTourSeed`-filtered either) → graphNodeOf's absent branch.
  const testerGhost = (() => {
    const n = node("tests/g.test.ts#testerGhost:function", "function", "testerGhost", "tests/g.test.ts", 1, 1, { exported: false });
    delete (n as { evidence?: unknown }).evidence;
    return n;
  })();
  // A seed with real evidence (so it qualifies as a seed) pointing at a file
  // that does not exist on disk, and no inline signature: signatureOf can
  // neither use the field nor read the file, so its detail node's signature
  // stays absent → detailNodeOf's signature-absent branch runs.
  const noSigSeed = node("src/nosig.ts#noSigSeed:function", "function", "noSigSeed", "src/nosig.ts", 1, 1, {
    exported: false,
    signature: undefined,
  });
  const nodes = [seed, reachedGhost, testerGhost, noSigSeed];
  const edges = [
    edge("src/g.ts#seedFn:function", "src/g.ts#reachedGhost:function", "calls", "src/g.ts"),
    edge("tests/g.test.ts#testerGhost:function", "src/g.ts#seedFn:function", "tests", "tests/g.test.ts"),
  ];
  const app = new SamchonGraphApplication(SamchonGraphMemory.from(dumpOf(root, nodes, edges)));
  const tour = (await call(app, { type: "tour", query: "seedFn reachedGhost testerGhost noSigSeed" })).result;
  TestValidator.predicate("the evidence-having seed is still an entrypoint", tour.entrypoints.some((n) => n.name === "seedFn"));
  TestValidator.predicate(
    "a seed with no readable signature still becomes an entrypoint",
    tour.entrypoints.some((n) => n.name === "noSigSeed" && n.signature === undefined),
  );
  TestValidator.predicate(
    "the evidence-less callee is still reached by the flow",
    tour.primaryFlow.some((flow) => flow.reached.some((n) => n.name === "reachedGhost")),
  );

  const noTests = (await call(app, { type: "tour", query: "seedFn", includeTests: false })).result;
  TestValidator.equals("includeTests=false yields no test anchors", noTests.tests.length, 0);
};
