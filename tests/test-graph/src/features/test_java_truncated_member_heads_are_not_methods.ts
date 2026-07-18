import fs from "node:fs";
import path from "node:path";

import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";

import { GraphPaths } from "../internal/GraphPaths";

/**
 * A Java member head whose delimiters never close is not a member. A generic
 * clause opened with `<` and left unbalanced, or a parameter list opened with
 * `(` and never closed, must make the parser decline the member rather than
 * invent a method — the class around it is still indexed.
 */
export const test_java_truncated_member_heads_are_not_methods = async () => {
  const root = GraphPaths.createTempDirectory("samchon-java-truncated-");
  fs.writeFileSync(
    path.join(root, "Angle.java"),
    ["class Angle {", "  <T truncated();", "}"].join("\n"),
  );
  fs.writeFileSync(
    path.join(root, "Paren.java"),
    ["class Paren {", "  void unclosed(", "}"].join("\n"),
  );

  const dump = await buildGraphDump({ cwd: root, mode: "static", languages: ["java"] });
  const kindOf = (name: string) =>
    dump.nodes.find((node) => node.name === name)?.kind;

  TestValidator.equals(
    "the enclosing classes are still indexed",
    [kindOf("Angle"), kindOf("Paren")],
    ["class", "class"],
  );
  TestValidator.equals(
    "an unbalanced generic clause does not yield a method",
    kindOf("truncated"),
    undefined,
  );
  TestValidator.equals(
    "an unclosed parameter list does not yield a method",
    kindOf("unclosed"),
    undefined,
  );
};
