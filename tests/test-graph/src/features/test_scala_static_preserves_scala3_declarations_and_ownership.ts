import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";
import fs from "node:fs";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";

export const test_scala_static_preserves_scala3_declarations_and_ownership =
  async () => {
    const root = GraphPaths.createTempDirectory("samchon-graph-scala3-semantics-");
    fs.writeFileSync(
      path.join(root, "Api.scala"),
      [
        "package demo",
        "",
        "object Api:",
        "  sealed trait Service:",
        "    protected def execute(value: String): String",
        "",
        "  enum Color:",
        "    case Red, Blue",
        "    def rgb: Int = ordinal",
        "",
        "  opaque type UserId = Long",
        "  object UserId:",
        "    def apply(",
        "      value: Long,",
        "    ): UserId = value",
        "",
        "  given listOrdering[A](using ordering: Ordering[A]): Ordering[List[A]] with",
        "    override def compare(left: List[A], right: List[A]): Int = left.size - right.size",
        "",
        "  given Conversion[String, UserId] with",
        "    def apply(value: String): UserId = UserId(value.toLong)",
        "",
        "  extension (id: UserId)",
        "    def value: Long = id",
        "    private def hiddenValue: Long = id",
        "",
        "  object Facade:",
        "    def execute(): String = \"ok\"",
        "",
        "  export Facade.{execute as run}",
        "",
        "  def invoke(): String =",
        "    final class Local",
        "    Facade.execute()",
        "end Api",
        "",
        "abstract class Repository",
        "final class DefaultRepository extends Repository:",
        "  def load(): String = Api.invoke()",
        "",
        "opaque type Token = String",
        "given defaultToken: Token = \"token\"",
        "private val secret = \"hidden\"",
        "",
        "/*",
        "object GhostFromComment:",
        "  def ghost(): Unit = ()",
        "*/",
        "val prose = \"\"\"",
        "class GhostFromString",
        "\"\"\"",
        "",
        "object Braced {",
        "  def inside(): Unit = {",
        "    println(\"inside\")",
        "  }",
        "}",
        "",
        "@main",
        "def Main(): Unit =",
        "  Api.invoke()",
        "  Braced.inside()",
        "",
        "private def hiddenTop(): Unit = ()",
        "",
      ].join("\n"),
    );

    const dump = await buildGraphDump({
      cwd: root,
      mode: "static",
      languages: ["scala"],
    });
    const named = (qualifiedName: string, kind?: string) =>
      dump.nodes.find(
        (node) =>
          (node.qualifiedName ?? node.name) === qualifiedName &&
          (kind === undefined || node.kind === kind),
      );

    TestValidator.equals(
      "Scala 3 declarations keep their graph kinds",
      [
        named("Api")?.kind,
        named("Api.Service")?.kind,
        named("Api.Service.execute")?.kind,
        named("Api.Color")?.kind,
        named("Api.Color.rgb")?.kind,
        named("Api.UserId", "type")?.kind,
        named("Api.UserId", "module")?.kind,
        named("Api.UserId.apply")?.kind,
        named("Api.listOrdering")?.kind,
        named("Api.given Conversion[String,UserId]")?.kind,
        named("Api.value")?.kind,
        named("Api.hiddenValue")?.kind,
        named("Api.Facade.execute")?.kind,
        named("Api.invoke")?.kind,
        named("Api.invoke.Local")?.kind,
        named("Repository")?.kind,
        named("DefaultRepository")?.kind,
        named("Token")?.kind,
        named("defaultToken")?.kind,
        named("secret")?.kind,
        named("Braced.inside")?.kind,
        named("Main")?.kind,
        named("hiddenTop")?.kind,
      ],
      [
        "module",
        "interface",
        "method",
        "enum",
        "method",
        "type",
        "module",
        "method",
        "property",
        "property",
        "method",
        "method",
        "method",
        "method",
        "class",
        "class",
        "class",
        "type",
        "variable",
        "variable",
        "method",
        "function",
        "function",
      ],
    );
    TestValidator.equals(
      "Scala visibility, abstractness, and immutable bindings survive",
      [
        named("Api")?.modifiers,
        named("Api.Service")?.modifiers,
        named("Api.Service.execute")?.modifiers,
        named("Api.value")?.modifiers,
        named("Api.hiddenValue")?.modifiers,
        named("Repository")?.modifiers,
        named("defaultToken")?.modifiers,
        named("secret")?.modifiers,
        named("Api.invoke.Local")?.modifiers,
        named("hiddenTop")?.modifiers,
      ],
      [
        ["public"],
        ["public"],
        ["protected"],
        ["public"],
        ["private"],
        ["public", "abstract"],
        ["public", "readonly"],
        ["private", "readonly"],
        undefined,
        ["private"],
      ],
    );
    TestValidator.equals(
      "only public top-level Scala declarations seed the module export surface",
      [
        named("Api")?.exported,
        named("Api.invoke")?.exported,
        named("Repository")?.exported,
        named("Token")?.exported,
        named("defaultToken")?.exported,
        named("secret")?.exported,
        named("Main")?.exported,
        named("hiddenTop")?.exported,
      ],
      [true, undefined, true, true, true, undefined, true, undefined],
    );
    TestValidator.predicate(
      "indentation, end markers, braces, and transparent extensions retain owners",
      [
        ["Api", "Api.Service"],
        ["Api.Service", "Api.Service.execute"],
        ["Api", "Api.Color"],
        ["Api.Color", "Api.Color.rgb"],
        ["Api", "Api.value"],
        ["Api", "Api.hiddenValue"],
        ["Api", "Api.invoke"],
        ["Api.invoke", "Api.invoke.Local"],
        ["Braced", "Braced.inside"],
      ].every(([owner, child]) =>
        dump.edges.some(
          (edge) =>
            edge.kind === "contains" &&
            edge.from === named(owner!)?.id &&
            edge.to === named(child!)?.id,
        ),
      ),
    );
    TestValidator.predicate(
      "Scala inheritance and qualified calls resolve against their real owners",
      dump.edges.some(
        (edge) =>
          edge.kind === "extends" &&
          edge.from === named("DefaultRepository")?.id &&
          edge.to === named("Repository")?.id,
      ) &&
        dump.edges.some(
          (edge) =>
            edge.kind === "calls" &&
            edge.from === named("Main")?.id &&
            edge.to === named("Api.invoke")?.id,
        ) &&
        dump.edges.some(
          (edge) =>
            edge.kind === "calls" &&
            edge.from === named("Api.invoke")?.id &&
            edge.to === named("Api.Facade.execute")?.id,
        ),
    );
    TestValidator.equals(
      "comments and multiline strings cannot manufacture Scala declarations",
      dump.nodes.filter((node) => node.name.startsWith("GhostFrom")).length,
      0,
    );
    TestValidator.predicate(
      "a Scala package clause is ownership metadata, not an imported dependency",
      dump.edges.every(
        (edge) =>
          edge.kind !== "imports" ||
          edge.to !== "external:scala:demo",
      ),
    );
  };
