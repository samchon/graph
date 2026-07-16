import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { TestValidator } from "@nestia/e2e";
import { buildGraph } from "@samchon/graph";

export const test_c_static_linkage_controls_export_surface = async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-c-linkage-"));
  fs.writeFileSync(
    path.join(root, "service.c"),
    [
      "static int helper(void) {",
      "  return 1;",
      "}",
      "int public_api(void) {",
      "  if (helper()) return 1;",
      "  return 0;",
      "}",
    ].join("\n"),
  );

  const graph = await buildGraph({
    cwd: root,
    mode: "static",
    languages: ["c"],
  });
  const helper = graph.nodes.find((node) => node.name === "helper");
  const publicApi = graph.nodes.find((node) => node.name === "public_api");

  TestValidator.predicate(
    "the C fixture exposes both declarations",
    helper !== undefined && publicApi !== undefined,
  );
  TestValidator.equals(
    "a file-local static C function is not on the public surface",
    helper?.exported === true,
    false,
  );
  TestValidator.equals(
    "a C function with external linkage remains on the public surface",
    publicApi?.exported,
    true,
  );
  TestValidator.equals(
    "a C control statement is never synthesized as a function",
    graph.nodes.some((node) => node.name === "if"),
    false,
  );
};
