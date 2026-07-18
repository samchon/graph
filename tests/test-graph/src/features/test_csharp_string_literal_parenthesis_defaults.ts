import fs from "node:fs";
import path from "node:path";

import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";
import { CsharpDeclarations } from "@samchon/graph-sitter";

import { GraphPaths } from "../internal/GraphPaths";

/**
 * A `(` or `)` inside a string default value is text, not a parameter
 * boundary. The parameter scan has to mask string and character literals
 * before counting, or the head never balances: the method is lost and the
 * default's own `=` is misread as a field.
 */
export const test_csharp_string_literal_parenthesis_defaults = async () => {
  const parse = CsharpDeclarations.parseCSharpDeclaration;

  // The witness from the report: the `(` inside the default value must not be
  // counted as an opening parenthesis, so `Log` stays a method and no phantom
  // `prefix` field is invented from the default assignment.
  TestValidator.equals(
    "a parenthesis inside a string default keeps the method and invents no field",
    [
      parse('public void Log(string prefix = "(") { }', "Svc", "class"),
      parse('public void Trace(string suffix = ")") { }', "Svc", "class"),
      parse("public void At(char open = '(') { }", "Svc", "class"),
      parse('public void Greet(string who = "world") { }', "Svc", "class"),
    ],
    [
      { kind: "method", name: "Log", modifiers: ["public"] },
      { kind: "method", name: "Trace", modifiers: ["public"] },
      { kind: "method", name: "At", modifiers: ["public"] },
      { kind: "method", name: "Greet", modifiers: ["public"] },
    ],
  );

  // The negative twin: a genuine field whose initializer merely contains
  // parentheses is still a field, not a method.
  TestValidator.equals(
    "a field whose initializer contains parentheses is still a field",
    parse('public string Pattern = "(hello)";', "Svc", "class"),
    { kind: "field", name: "Pattern", modifiers: ["public"] },
  );

  // The boundary: a head whose parameter list never closes has no matching
  // parenthesis, so it is declined rather than misfiled as a member.
  TestValidator.equals(
    "an unterminated parameter list is not indexed as a member",
    parse("void Broken(int a", "Svc", "class"),
    undefined,
  );

  const root = GraphPaths.createTempDirectory("samchon-csharp-string-parens-");
  fs.writeFileSync(
    path.join(root, "Service.cs"),
    [
      "namespace Demo;",
      "",
      "public class Service",
      "{",
      '    public void Log(string prefix = "(") { }',
      '    public string Pattern = "(hello)";',
      '    public void Greet(string who = "world") { }',
      "}",
      "",
    ].join("\n"),
  );

  const graph = await buildGraphDump({
    cwd: root,
    mode: "static",
    languages: ["csharp"],
  });
  const node = (qualifiedName: string) =>
    graph.nodes.find((n) => (n.qualifiedName ?? n.name) === qualifiedName);

  TestValidator.equals(
    "the string-default method survives the whole-file dump",
    node("Demo.Service.Log")?.kind,
    "method",
  );
  TestValidator.equals(
    "a normal string-default method survives too",
    node("Demo.Service.Greet")?.kind,
    "method",
  );
  TestValidator.equals(
    "the genuine field is still a field",
    node("Demo.Service.Pattern")?.kind,
    "field",
  );
  TestValidator.equals(
    "no phantom field is invented from the default value",
    graph.nodes.some((n) => n.name === "prefix"),
    false,
  );
};
