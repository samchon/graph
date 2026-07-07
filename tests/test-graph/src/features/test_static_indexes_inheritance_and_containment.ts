import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";

import { GraphFixtures } from "../internal/GraphFixtures";

export const test_static_indexes_inheritance_and_containment = async () => {
  const root = GraphFixtures.createInheritanceFixture();
  const dump = await buildGraphDump({ cwd: root, mode: "static" });

  const has = (kind: string, from: string, to: string) =>
    dump.edges.some(
      (edge) => edge.kind === kind && edge.from.includes(from) && edge.to.includes(to),
    );

  // Containment: a class contains its member.
  TestValidator.predicate("class contains its method", has("contains", "Service:class", "Service.run"));

  // extends / implements via keywords, resolved across files and within a list.
  TestValidator.predicate("extends across files", has("extends", "Service:class", "base.ts#Base:class"));
  TestValidator.predicate("implements first interface", has("implements", "Service:class", "Runner:interface"));
  TestValidator.predicate("implements second interface", has("implements", "Service:class", "Loggable:interface"));
  TestValidator.predicate("generic supertype is stripped", has("extends", "Generic:class", "Container:class"));

  // Colon form with modifiers (C#), access-modifier base list (C++).
  TestValidator.predicate("csharp colon extends", has("extends", "User:class", "Entity:class"));
  TestValidator.predicate("cpp public base", has("extends", "Derived:class", "CppBase:class"));
  TestValidator.predicate("cpp private base", has("extends", "Derived:class", "Helper:class"));

  // Python parentheses, Ruby `<`, Kotlin constructor call, Scala `with`.
  TestValidator.predicate("python base", has("extends", "Dog:class", "Animal:class"));
  TestValidator.predicate("ruby base", has("extends", "Car:class", "Vehicle:class"));
  TestValidator.predicate("kotlin constructor base", has("extends", "KFoo:class", "KBase:class"));
  TestValidator.predicate("scala with is an implements", has("implements", "Foo:class", "Baz:interface"));
  TestValidator.predicate("scala extends", has("extends", "Foo:class", "Bar:class"));

  // A subclass method with the same name as a supertype method overrides it.
  TestValidator.predicate("override across files", has("overrides", "Service.run:method", "Base.run:method"));
  TestValidator.predicate(
    "non-matching subclass method does not override",
    dump.edges.every((edge) => edge.kind !== "overrides" || !edge.from.includes("Service.extra")),
  );

  // A decorator directly above a declaration links to the decorator symbol.
  TestValidator.predicate("decorator becomes a decorates edge", has("decorates", "Service:class", "Injectable:function"));
  TestValidator.predicate(
    "unresolved decorator dropped",
    dump.edges.every((edge) => edge.kind !== "decorates" || !edge.to.includes("Missing")),
  );

  // Unresolved supertypes never produce an edge.
  TestValidator.predicate(
    "unresolved supertype is dropped",
    dump.edges.every((edge) => !edge.to.includes("Missing")),
  );
  // The duplicate C# supertype collapses to a single edge.
  TestValidator.equals(
    "duplicate supertype deduped",
    dump.edges.filter((edge) => edge.kind === "extends" && edge.from.includes("Dup:class")).length,
    1,
  );
};
