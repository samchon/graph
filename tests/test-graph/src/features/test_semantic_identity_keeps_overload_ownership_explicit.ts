import { TestValidator } from "@nestia/e2e";
import {
  ISamchonGraphEdge,
  ISamchonGraphNode,
  markClosures,
  overrideEdges,
  semanticGraphNodeId,
} from "@samchon/graph";

export const test_semantic_identity_keeps_overload_ownership_explicit = () => {
  const base = container("Base");
  const derived = container("Derived");
  const basePlain = [member("Base", "run", "base-1"), member("Base", "run", "base-2")];
  const derivedPlain = [
    member("Derived", "run", "derived-1"),
    member("Derived", "run", "derived-2"),
  ];
  const baseDecorated = member("Base", "save(String)", "base-save");
  const derivedDecorated = member("Derived", "save(String)", "derived-save");
  const local = member("Derived.run", "local", "local", "function");
  const nodes = [
    base,
    derived,
    ...basePlain,
    ...derivedPlain,
    baseDecorated,
    derivedDecorated,
    local,
  ];
  const edges: ISamchonGraphEdge[] = [
    { from: derived.id, to: base.id, kind: "extends" },
    ...basePlain.map((node) => ({
      from: base.id,
      to: node.id,
      kind: "contains" as const,
    })),
    ...derivedPlain.map((node) => ({
      from: derived.id,
      to: node.id,
      kind: "contains" as const,
    })),
    { from: base.id, to: baseDecorated.id, kind: "contains" },
    { from: derived.id, to: derivedDecorated.id, kind: "contains" },
    { from: derivedPlain[0]!.id, to: local.id, kind: "contains" },
  ];

  const overrides = overrideEdges(nodes, edges);
  TestValidator.equals(
    "ambiguous undecorated overload groups do not invent pairings",
    overrides.filter((edge) => derivedPlain.some((node) => node.id === edge.from)),
    [],
  );
  TestValidator.equals(
    "an exact decorated overload pairs by signature",
    overrides.filter((edge) => edge.from === derivedDecorated.id),
    [
      {
        from: derivedDecorated.id,
        to: baseDecorated.id,
        kind: "overrides",
      },
    ],
  );

  markClosures(nodes, edges);
  TestValidator.equals(
    "explicit semantic ownership marks a nested declaration as a closure",
    local.closure,
    true,
  );
  TestValidator.equals(
    "sibling overload declarations remain surface members",
    derivedPlain.map((node) => node.closure),
    [undefined, undefined],
  );
};

const container = (name: string): ISamchonGraphNode => ({
  id: semanticGraphNodeId(
    {
      version: 2,
      language: "java",
      symbol: name,
      role: "class",
      native: { key: `T:${name}`, stability: "semantic" },
      stability: "persistent",
    },
    name,
  ),
  kind: "class",
  language: "java",
  name,
  file: `${name}.java`,
  external: false,
});

const member = (
  owner: string,
  name: string,
  generation: string,
  kind: "method" | "function" = "method",
): ISamchonGraphNode => ({
  id: semanticGraphNodeId(
    {
      version: 2,
      language: "java",
      symbol: `${owner}.${name.includes("(") ? name.slice(0, name.indexOf("(")) : name}`,
      role: kind,
      ...(name.includes("(") ? { overload: name.slice(name.indexOf("(")) } : {}),
      stability: "generation",
      generation,
    },
    `${owner}.${name}`,
  ),
  kind,
  language: "java",
  name,
  qualifiedName: `${owner}.${name}`,
  file: `${owner.split(".")[0]}.java`,
  external: false,
});
