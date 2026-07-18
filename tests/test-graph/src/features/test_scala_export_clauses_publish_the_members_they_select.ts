import { TestValidator } from "@nestia/e2e";

import { ScalaDeclarations } from "@samchon/graph-sitter";

export const test_scala_export_clauses_publish_the_members_they_select = () => {
  // Scala 3's `export` republishes another object's members under the template
  // that writes the clause: `export Facade.execute` makes `Api.run` a real path
  // to `Facade.execute` without declaring anything new. What is republished,
  // under which name, and from which template are three separate facts, and the
  // clause spells all three.
  const lines = [
    "object Api:",
    "  object Inner:",
    "    export Facade.{execute as run, reset, *}",
    "",
    "  export Facade.status",
    "",
    "export scala.collection.mutable.Map",
    "export printer.{status as _, *}",
    "export Facade",
    "export a.b().c",
    "",
    "object Facade:",
    "  def execute(): String = \"ok\"",
    "  def reset(): Unit = ()",
    "  def status(): String = \"up\"",
  ];
  const exports = ScalaDeclarations.exportsOf(lines);

  TestValidator.equals(
    "an export names its target, its selectors, and the template it publishes from",
    [...exports].map(([index, clause]) => [
      index,
      clause.ownerNames.join("."),
      clause.target,
      clause.names,
    ]),
    [
      [
        2,
        "Api.Inner",
        "Facade",
        [{ name: "execute", alias: "run" }, { name: "reset" }, { name: "*" }],
      ],
      [4, "Api", "Facade", [{ name: "status" }]],
      [6, "", "scala.collection.mutable", [{ name: "Map" }]],
      [7, "", "printer", [{ name: "*" }]],
    ],
  );

  // `as _` is Scala's exclusion, not a rename: it names a member so that the
  // wildcard beside it does *not* publish it. Reading it as an alias would put
  // `printer.status` on the surface under the name `_`.
  TestValidator.equals(
    "`as _` withholds a member instead of republishing it under `_`",
    exports.get(7)?.names,
    [{ name: "*" }],
  );

  // `export` needs a receiver path to export from. A bare name has none, and a
  // path that is an expression rather than a template is not one the graph can
  // resolve to a declaration, so neither may invent a clause.
  TestValidator.equals(
    "a bare `export`, or one whose path is an expression, publishes nothing",
    [exports.get(8), exports.get(9)],
    [undefined, undefined],
  );
  TestValidator.equals(
    "a file with no export clause has no export surface to report",
    [...ScalaDeclarations.exportsOf(["object Api:", "  def run(): Unit = ()"])],
    [],
  );
};
