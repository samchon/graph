import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";

import { GraphFixtures } from "../internal/GraphFixtures";
import { GraphPaths } from "../internal/GraphPaths";

export const test_java_preserves_methods_visibility_and_anonymous_identity = async () => {
  const root = GraphFixtures.createJavaAnonymousFixture();
  const lsp = await buildGraphDump({
    cwd: root,
    mode: "lsp",
    languages: ["java"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer, "--java-anonymous"],
  });

  const publicApi = lsp.nodes.find((node) => node.name === "PublicApi");
  const packageType = lsp.nodes.find((node) => node.name === "PackageType");
  TestValidator.equals(
    "Java LSP exports only a public top-level type",
    [publicApi?.exported, packageType?.exported],
    [true, undefined],
  );
  TestValidator.equals(
    "Java LSP records public top-level visibility",
    publicApi?.modifiers,
    ["public"],
  );
  TestValidator.equals(
    "Java LSP records member visibility and shape",
    [
      lsp.nodes.find((node) => node.name === "hidden()")?.modifiers,
      lsp.nodes.find((node) => node.name === "packageOnly()")?.modifiers,
      lsp.nodes.find((node) => node.name === "extensionPoint()")?.modifiers,
    ],
    [["private"], undefined, ["protected", "static"]],
  );
  TestValidator.equals(
    "a public nested Java class is not a compilation-unit export",
    lsp.nodes.find((node) => node.name === "Nested")?.exported,
    undefined,
  );

  const anonymous = lsp.nodes.filter(
    (node) => node.kind === "class" && node.name.startsWith("new Adapter()"),
  );
  TestValidator.predicate(
    "JDT anonymous classes remain addressable but are closure-scoped",
    anonymous.length === 2 && anonymous.every((node) => node.closure === true),
  );
  const anonymousOverrides = lsp.nodes.filter(
    (node) =>
      node.name === "write()" &&
      node.qualifiedName?.includes("new Adapter()") === true,
  );
  TestValidator.predicate(
    "anonymous-class override descendants inherit closure scope",
    anonymousOverrides.length === 2 &&
      anonymousOverrides.every((node) => node.closure === true),
  );
  const adapter = lsp.nodes.find(
    (node) => node.kind === "class" && node.name === "Adapter",
  );
  const instantiations = lsp.edges.filter(
    (edge) => edge.kind === "instantiates",
  );
  TestValidator.predicate(
    "JDT anonymous identities never become cross-product instantiation targets",
    adapter !== undefined &&
      instantiations.length > 0 &&
      instantiations.every((edge) => edge.to === adapter.id),
  );

  const statically = await buildGraphDump({
    cwd: root,
    mode: "static",
    languages: ["java"],
  });
  const staticNode = (qualifiedName: string) =>
    statically.nodes.find((node) => node.qualifiedName === qualifiedName);
  TestValidator.equals(
    "Java static fallback distinguishes a constructor from a method",
    [
      staticNode("PublicApi.PublicApi")?.kind,
      statically.nodes.find(
        (node) =>
          node.qualifiedName === "PublicApi.PublicApi" &&
          node.kind === "method",
      )?.kind,
    ],
    ["constructor", undefined],
  );
  TestValidator.predicate(
    "Java static fallback keeps ordinary and multiline return-typed methods",
    [
      "first",
      "second",
      "convert",
      "names",
      "hidden",
      "packageOnly",
      "extensionPoint",
    ].every(
      (name) => staticNode(`PublicApi.${name}`)?.kind === "method",
    ),
  );
  TestValidator.equals(
    "Java static fallback preserves method visibility modifiers",
    [
      staticNode("PublicApi.hidden")?.modifiers,
      staticNode("PublicApi.packageOnly")?.modifiers,
      staticNode("PublicApi.extensionPoint")?.modifiers,
    ],
    [["private"], undefined, ["protected", "static"]],
  );
  TestValidator.equals(
    "Java static fallback keeps publicness at compilation-unit scope",
    [
      statically.nodes.find((node) => node.name === "PublicApi")?.exported,
      staticNode("PublicApi.Nested")?.exported,
      statically.nodes.find((node) => node.name === "PackageType")?.exported,
    ],
    [true, undefined, undefined],
  );
  TestValidator.predicate(
    "Java statement calls and controls do not become phantom declarations",
    statically.nodes.every(
      (node) =>
        node.qualifiedName !== "PublicApi.helper" && node.name !== "if",
    ),
  );
};
