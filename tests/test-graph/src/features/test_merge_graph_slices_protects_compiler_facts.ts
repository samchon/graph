import { TestValidator } from "@nestia/e2e";
import {
  ISamchonGraphEdge,
  ISamchonGraphNode,
  semanticGraphNodeId,
} from "@samchon/graph";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { GraphPaths } from "../internal/GraphPaths";

interface IMergeOptions {
  root: string;
  files: readonly string[];
  genericNodes: ISamchonGraphNode[];
  genericEdges: ISamchonGraphEdge[];
  strictNodes: ISamchonGraphNode[];
  strictEdges: ISamchonGraphEdge[];
}

/**
 * `mergeGraphSlices` has no public export: it is the internal seam where the
 * compiler-owned provider slice meets the best-effort lane, so it is reached
 * through the shipped artifact the same way the other internal units are.
 */
const importLib = <T>(relative: string): Promise<T> =>
  import(
    pathToFileURL(path.join(GraphPaths.graphPackageRoot, "lib", relative)).href
  ) as Promise<T>;

const STRICT_FILE = "src/strict.ts";
const GENERIC_FILE = "src/generic.ts";

const node = (
  id: string,
  name: string,
  file: string,
  kind: ISamchonGraphNode["kind"] = "function",
): ISamchonGraphNode => ({
  id,
  kind,
  language: "typescript",
  name,
  file,
  external: false,
});

const STRICT_HANDLER = `${STRICT_FILE}#handler:function`;
const STRICT_SERVICE = `${STRICT_FILE}#Service:class`;
const GENERIC_HELPER = `${GENERIC_FILE}#helper:function`;

export const test_merge_graph_slices_protects_compiler_facts = async () => {
  const { mergeGraphSlices } = await importLib<{
    mergeGraphSlices: (options: IMergeOptions) => {
      nodes: ISamchonGraphNode[];
      edges: ISamchonGraphEdge[];
      warnings: string[];
    };
  }>("provider/mergeGraphSlices.js");

  const root = GraphPaths.createTempDirectory("samchon-merge-slices-");
  const merge = (overrides: Partial<IMergeOptions>) =>
    mergeGraphSlices({
      root,
      files: [],
      genericNodes: [],
      genericEdges: [],
      strictNodes: [],
      strictEdges: [],
      ...overrides,
    });

  // A compiler already resolved its slice's containment, so the merge must hand
  // those exact facts back: the strict lane is not re-derived, and it leads the
  // merged output so a reader meets compiler truth before best-effort text.
  const merged = merge({
    strictNodes: [
      node(STRICT_SERVICE, "Service", STRICT_FILE, "class"),
      node(STRICT_HANDLER, "handler", STRICT_FILE),
    ],
    strictEdges: [{ from: STRICT_SERVICE, to: STRICT_HANDLER, kind: "calls" }],
    genericNodes: [node(GENERIC_HELPER, "helper", GENERIC_FILE)],
  });
  TestValidator.equals(
    "compiler-owned nodes pass through first and unchanged",
    merged.nodes.map((entry) => entry.id),
    [STRICT_SERVICE, STRICT_HANDLER, GENERIC_HELPER],
  );
  TestValidator.equals(
    "compiler-owned edges pass through unchanged",
    merged.edges.filter((edge) => edge.kind === "calls"),
    [{ from: STRICT_SERVICE, to: STRICT_HANDLER, kind: "calls" }],
  );

  // A strict slice that states the same identity twice is a provider defect.
  // Silently de-duplicating it would let that defect reach a caller as fact, so
  // the merge refuses the slice instead of quietly repairing it — the same
  // reason the generic lane's dedupe is not applied to compiler output.
  await TestValidator.error("a strict slice cannot declare one node twice", () =>
    merge({
      strictNodes: [
        node(STRICT_HANDLER, "handler", STRICT_FILE),
        node(STRICT_HANDLER, "handler", STRICT_FILE),
      ],
    }),
  );
  await TestValidator.error("a strict slice cannot state one edge twice", () =>
    merge({
      strictNodes: [
        node(STRICT_SERVICE, "Service", STRICT_FILE, "class"),
        node(STRICT_HANDLER, "handler", STRICT_FILE),
      ],
      strictEdges: [
        { from: STRICT_SERVICE, to: STRICT_HANDLER, kind: "calls" },
        { from: STRICT_SERVICE, to: STRICT_HANDLER, kind: "calls" },
      ],
    }),
  );

  // An edge is a claim about two declarations. A strict endpoint the same slice
  // never declared is a dangling claim, and a graph that accepted it would hand
  // back a handle that resolves to nothing.
  await TestValidator.error(
    "a strict edge cannot point at a node its slice never declared",
    () =>
      merge({
        strictNodes: [node(STRICT_SERVICE, "Service", STRICT_FILE, "class")],
        strictEdges: [
          { from: STRICT_SERVICE, to: STRICT_HANDLER, kind: "calls" },
        ],
      }),
  );
  await TestValidator.error(
    "a strict edge cannot originate at a symbol its slice never declared",
    () =>
      merge({
        strictNodes: [node(STRICT_HANDLER, "handler", STRICT_FILE)],
        strictEdges: [
          { from: STRICT_SERVICE, to: STRICT_HANDLER, kind: "calls" },
        ],
      }),
  );

  // A file is the one endpoint a slice does not have to declare as a symbol: a
  // module's own top-level statements hang off the file container, whose id is
  // the path rather than a `file#symbol` identity. Rejecting it would drop
  // every module-scope fact the compiler reported.
  const fileScoped = merge({
    strictNodes: [node(STRICT_HANDLER, "handler", STRICT_FILE)],
    strictEdges: [{ from: STRICT_FILE, to: STRICT_HANDLER, kind: "calls" }],
  });
  TestValidator.equals(
    "a strict edge may hang off the file container it was written in",
    fileScoped.edges.some(
      (edge) => edge.from === STRICT_FILE && edge.to === STRICT_HANDLER,
    ),
    true,
  );

  // A strict provider owns its semantic ids, so an id that says TypeScript but
  // is attached to a Go fact is corrupt provider output rather than a generic
  // fallback ambiguity the merge may repair.
  const typeScriptClassId = semanticGraphNodeId(
    {
      version: 2,
      language: "typescript",
      symbol: "Service",
      role: "class",
      native: { key: "Service", stability: "semantic" },
      stability: "persistent",
    },
    "Service",
  );
  await TestValidator.error(
    "a strict semantic id must match its provider fact language",
    () =>
      merge({
        strictNodes: [
          {
            ...node(typeScriptClassId, "Service", STRICT_FILE, "class"),
            language: "go",
          },
        ],
      }),
  );
  const goClassId = semanticGraphNodeId(
    {
      version: 2,
      language: "go",
      symbol: "Service",
      role: "class",
      native: { key: "Service", stability: "semantic" },
      stability: "persistent",
    },
    "Service",
  );
  await TestValidator.error(
    "a strict semantic id must match its provider fact kind",
    () =>
      merge({
        strictNodes: [
          {
            ...node(goClassId, "Service", STRICT_FILE, "class"),
            language: "go",
            kind: "function",
          },
        ],
      }),
  );

  // A generic C# provider can observe one partial declaration at several
  // locations. The merged graph retains its canonical declaration and
  // implementation spans, while exposing the overflow to callers as a warning.
  const genericPartialLocations = [1, 2, 3].map((startLine) => ({
    ...node(
      "src/Service.cs#Service:class",
      "Service",
      "src/Service.cs",
      "class",
    ),
    language: "csharp" as const,
    modifiers: ["partial"],
    evidence: { file: "src/Service.cs", startLine },
  }));
  const genericLocations = merge({ genericNodes: genericPartialLocations });
  TestValidator.equals(
    "generic partial locations retain declaration and implementation spans",
    genericLocations.nodes.map((entry) => [
      entry.evidence?.startLine,
      entry.implementation?.startLine,
    ]),
    [[1, 2]],
  );
  TestValidator.equals(
    "generic partial location overflow is reported",
    genericLocations.warnings,
    [
      `@samchon/graph: generic semantic declaration has 3 locations; retaining canonical declaration and implementation spans: ${genericLocations.nodes[0]!.id}`,
    ],
  );

  // The lanes index disjoint languages, so one identity claimed by both means a
  // lane escaped its language. Letting either win would decide, silently and by
  // merge order, whether a caller reads compiler truth or a text guess.
  await TestValidator.error(
    "a best-effort node may not claim a compiler-owned identity",
    () =>
      merge({
        strictNodes: [node(STRICT_HANDLER, "handler", STRICT_FILE)],
        genericNodes: [node(STRICT_HANDLER, "handler", STRICT_FILE)],
      }),
  );
  await TestValidator.error(
    "a best-effort edge may not restate a compiler-owned relation",
    () =>
      merge({
        strictNodes: [
          node(STRICT_SERVICE, "Service", STRICT_FILE, "class"),
          node(STRICT_HANDLER, "handler", STRICT_FILE),
        ],
        strictEdges: [
          { from: STRICT_SERVICE, to: STRICT_HANDLER, kind: "calls" },
        ],
        genericNodes: [node(GENERIC_HELPER, "helper", GENERIC_FILE)],
        genericEdges: [
          { from: STRICT_SERVICE, to: STRICT_HANDLER, kind: "calls" },
        ],
      }),
  );
};
