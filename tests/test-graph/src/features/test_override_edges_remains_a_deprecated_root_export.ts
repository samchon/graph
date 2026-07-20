import {
  ISamchonGraphEdge,
  ISamchonGraphNode,
  overrideEdges,
} from "@samchon/graph";
import { TestValidator } from "@nestia/e2e";

export const test_override_edges_remains_a_deprecated_root_export = () => {
  const node = (
    id: string,
    kind: ISamchonGraphNode["kind"],
    name: string,
    implementation = false,
  ): ISamchonGraphNode => ({
    id,
    kind,
    language: "typescript",
    name,
    file: "src/example.ts",
    external: false,
    evidence: { file: "src/example.ts", startLine: 1 },
    ...(implementation
      ? { implementation: { file: "src/example.ts", startLine: 2 } }
      : {}),
  });
  const nodes = [
    node("Contract", "interface", "Contract"),
    node("Contract.run", "method", "run"),
    node("Contract.value", "property", "value"),
    node("Base", "class", "Base"),
    node("Base.save", "method", "save"),
    node("Worker", "class", "Worker"),
    node("Worker.run", "method", "run", true),
    node("Worker.value", "field", "value"),
    node("Worker.extra", "method", "extra"),
    node("Child", "class", "Child"),
    node("Child.save", "method", "save"),
    node("Orphan", "class", "Orphan"),
    node("Orphan.run", "method", "run"),
  ];
  const edges: ISamchonGraphEdge[] = [
    { from: "module", to: "Contract", kind: "imports" },
    { from: "Contract", to: "missing", kind: "contains" },
    { from: "Contract", to: "Base", kind: "contains" },
    { from: "Contract", to: "Contract.run", kind: "contains" },
    { from: "Contract", to: "Contract.value", kind: "contains" },
    { from: "Base", to: "Base.save", kind: "contains" },
    { from: "Worker", to: "Worker.run", kind: "contains" },
    { from: "Worker", to: "Worker.value", kind: "contains" },
    { from: "Worker", to: "Worker.extra", kind: "contains" },
    { from: "Child", to: "Child.save", kind: "contains" },
    { from: "Orphan", to: "Orphan.run", kind: "contains" },
    { from: "Worker", to: "Contract", kind: "implements" },
    { from: "Child", to: "Base", kind: "extends" },
    { from: "MissingSubtype", to: "Contract", kind: "implements" },
    { from: "Orphan", to: "MissingSupertype", kind: "extends" },
  ];

  TestValidator.equals(
    "the released root helper remains callable with its original behavior",
    overrideEdges(nodes, edges),
    [
      {
        from: "Worker.run",
        to: "Contract.run",
        kind: "implements",
        evidence: { file: "src/example.ts", startLine: 2 },
      },
      {
        from: "Worker.value",
        to: "Contract.value",
        kind: "implements",
        evidence: { file: "src/example.ts", startLine: 1 },
      },
      {
        from: "Child.save",
        to: "Base.save",
        kind: "overrides",
        evidence: { file: "src/example.ts", startLine: 1 },
      },
    ],
  );
  TestValidator.equals(
    "ambiguous subtype members are never paired by their insertion order",
    overrideEdges(
      [...nodes, node("Worker.run", "method", "run")],
      [
        ...edges,
        { from: "Worker", to: "Worker.run", kind: "contains" },
      ],
    ),
    [
      {
        from: "Worker.value",
        to: "Contract.value",
        kind: "implements",
        evidence: { file: "src/example.ts", startLine: 1 },
      },
      {
        from: "Child.save",
        to: "Base.save",
        kind: "overrides",
        evidence: { file: "src/example.ts", startLine: 1 },
      },
    ],
  );
};
