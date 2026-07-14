import { TestValidator } from "@nestia/e2e";
import { SamchonGraphMemory, SamchonGraphApplication } from "@samchon/graph";
import type { ISamchonGraphApplication } from "@samchon/graph";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const call = (
  app: SamchonGraphApplication,
  request: ISamchonGraphApplication.IProps["request"],
  question?: string,
) =>
  app.inspect_code_graph({
    // The tour ranks against the question, in the user's own words, so a test
    // that means to steer a tour writes it here — not into the request.
    question: question ?? `probe ${request.type}`,
    draft: { reason: `${request.type} branch coverage`, type: request.type },
    review: "Rich fixture exercises the ported engine branches.",
    request,
  });

// A real source tree so runDetails.objectLiteralMembers can read the object
// literal back from disk, plus nodes named for the tour damping buckets
// (error / config / serialization) and an internal/ path for the public-API
// noise filter.
const createRichFixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-rich-"));
  fs.mkdirSync(path.join(root, "src", "internal"), { recursive: true });
  const richFile = "src/rich.ts";
  fs.writeFileSync(
    path.join(root, richFile),
    [
      "export const settings = {", // line 1
      "  host: \"localhost\",", //     line 2  property
      "  // inline note", //           line 3  comment (skipped)
      "  connect() {", //              line 4  method
      "    return true;", //           line 5  nested (depth 2, skipped)
      "  },", //                       line 6
      "};", //                         line 7
    ].join("\n"),
  );

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

  const nodes = [
    node(`${richFile}#settings:variable`, "variable", "settings", richFile, 1, 7),
    node(`${richFile}#ErrorReporter:class`, "class", "ErrorReporter", richFile, 9, 9),
    node(`${richFile}#connectionConfig:variable`, "variable", "connectionConfig", richFile, 11, 11),
    node(`${richFile}#serializeState:function`, "function", "serializeState", richFile, 13, 13),
    node("src/internal/secret.ts#internalHelper:function", "function", "internalHelper", "src/internal/secret.ts", 1, 1),
    node(`${richFile}#hub:function`, "function", "hub", richFile, 20, 20),
    // Many callers so an impact trace with maxNodes=1 (maxHops=2) truncates.
    ...Array.from({ length: 5 }, (_, i) =>
      node(`${richFile}#caller${i}:function`, "function", `caller${i}`, richFile, 30 + i, 30 + i),
    ),
    node("tests/hub.test.ts#hubTest:function", "function", "hubTest", "tests/hub.test.ts", 1, 1),
  ];

  const edge = (from: string, to: string, kind: string) => ({
    from,
    to,
    kind,
    evidence: evidence(richFile, 1, 1),
  });
  const hub = `${richFile}#hub:function`;
  const edges = [
    ...Array.from({ length: 5 }, (_, i) => edge(`${richFile}#caller${i}:function`, hub, "calls")),
    edge("tests/hub.test.ts#hubTest:function", hub, "tests"),
  ];

  const dump = {
    project: root,
    languages: ["typescript"],

    indexer: "static" as const,
    nodes,
    edges,
    diagnostics: [],
    warnings: [],
  };
  return { root, dump };
};

export const test_ported_operation_engines_cover_rich_branches = async () => {
  const { dump } = createRichFixture();
  const app = new SamchonGraphApplication(SamchonGraphMemory.from(dump));

  // runDetails.objectLiteralMembers: the `settings` variable's object literal is
  // parsed from disk into a property (host) and a method (connect).
  const details = (await call(app, { type: "details", handles: ["settings"] })).result;
  const settingsNode = details.nodes.find((node) => node.name === "settings");
  TestValidator.predicate("object-literal property parsed", settingsNode?.members?.some((m) => m.name === "host" && m.kind === "property") === true);
  TestValidator.predicate("object-literal method parsed", settingsNode?.members?.some((m) => m.name === "connect" && m.kind === "method") === true);

  // runTour.broadTourDamping: a neutral query keeps error/config/serialization
  // symbols out of the leading answer surface (they are down-weighted).
  const tour = (await call(app, { type: "tour", reinterpretations: [] }, "how does the project connect")).result;
  TestValidator.predicate("tour returns a surface", tour.entrypoints.length >= 1);

  // runOverview + pathPolicy.isPublicApiNoisePath: the internal/ symbol is
  // excluded from public API even though it is exported.
  const overview = (await call(app, { type: "overview", aspect: "all" })).result;
  TestValidator.predicate("internal path excluded from public API", overview.publicApi.every((node) => node.name !== "internalHelper"));

  // runTrace impact + maxHops truncation: hub has 5 callers, maxNodes=1 caps
  // hops at 2, so the trace marks itself truncated.
  const trace = (await call(app, { type: "trace", from: "hub", direction: "impact", maxNodes: 1 })).result;
  TestValidator.predicate("impact trace truncates on hop cap", trace.truncated === true);
};
