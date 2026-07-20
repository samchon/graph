import { TestValidator } from "@nestia/e2e";
import {
  IGraphSemanticIdentity,
  ISamchonGraphEdge,
  ISamchonGraphNode,
  assignSemanticIdentities,
  dedupeNodes,
  semanticGraphNodeId,
} from "@samchon/graph";

export const test_semantic_identity_distinguishes_provider_symbols = async () => {
  const positional = identity({
    symbol: "demo.Service.run",
    native: { key: "+1", stability: "positional" },
    overload: "receiver=;parameters=java.lang.String",
  });
  const insertedAbove = identity({
    symbol: "demo.Service.run",
    native: { key: "+9", stability: "positional" },
    overload: "receiver=;parameters=java.lang.String",
  });
  TestValidator.equals(
    "a positional provider ordinal is not part of persistent identity",
    semanticGraphNodeId(positional, "demo.Service.run(String)"),
    semanticGraphNodeId(insertedAbove, "demo.Service.run(String)"),
  );
  TestValidator.notEquals(
    "a structural overload signature distinguishes siblings",
    semanticGraphNodeId(positional, "demo.Service.run(String)"),
    semanticGraphNodeId(
      identity({
        symbol: "demo.Service.run",
        native: { key: "+1", stability: "positional" },
        overload: "receiver=;parameters=java.lang.Integer",
      }),
      "demo.Service.run(Integer)",
    ),
  );

  for (const [label, left, right] of [
    ["constructor", "parameters=String", "parameters=Int"],
    ["generic arity", "arity=1", "arity=2"],
    ["extension receiver", "receiver=String", "receiver=Int"],
  ] as const) {
    TestValidator.notEquals(
      `${label} is part of semantic identity`,
      semanticGraphNodeId(
        identity({ symbol: `demo.${label}`, overload: left }),
        `demo.${label}`,
      ),
      semanticGraphNodeId(
        identity({ symbol: `demo.${label}`, overload: right }),
        `demo.${label}`,
      ),
    );
  }

  const scoped = (scope: IGraphSemanticIdentity.IScope) =>
    semanticGraphNodeId(
      identity({ symbol: "demo.same", scope }),
      "demo.same",
    );
  TestValidator.notEquals(
    "build targets distinguish same-named symbols",
    scoped({ target: "client" }),
    scoped({ target: "server" }),
  );
  TestValidator.notEquals(
    "translation units distinguish internal linkage",
    scoped({ translationUnit: "src/a.c" }),
    scoped({ translationUnit: "src/b.c" }),
  );
  TestValidator.notEquals(
    "modules distinguish same-named declarations",
    scoped({ module: "left" }),
    scoped({ module: "right" }),
  );

  const local = (document: string) =>
    semanticGraphNodeId(
      identity({
        symbol: "local 1",
        native: { key: "local 1", stability: "positional" },
        scope: { document },
        stability: "generation",
        generation: "snapshot-7",
      }),
      "local 1",
    );
  TestValidator.notEquals(
    "SCIP locals are document scoped",
    local("src/a.go"),
    local("src/b.go"),
  );
  TestValidator.predicate(
    "unstable locals advertise generation scope in the id",
    local("src/a.go").startsWith("@g2/"),
  );
  await TestValidator.error(
    "a document-local native key cannot omit document scope",
    () =>
      semanticGraphNodeId(
        identity({
          symbol: "local 1",
          native: { key: "local 1", stability: "positional" },
          stability: "generation",
          generation: "snapshot-7",
        }),
        "local 1",
      ),
  );

  const stable = identity({
    symbol: "demo.Service.run",
    native: { key: "M:demo.Service.run(System.String)", stability: "semantic" },
    overload: "parameters=System.String",
  });
  TestValidator.equals(
    "source positions and bodies are absent from provider-stable identity",
    semanticGraphNodeId(stable, "demo.Service.run(String)"),
    semanticGraphNodeId({ ...stable }, "demo.Service.run(String)"),
  );

  const partialId = semanticGraphNodeId(
    identity({
      symbol: "demo.Partial",
      language: "csharp",
      role: "class",
      native: { key: "T:demo.Partial", stability: "semantic" },
    }),
    "demo.Partial",
  );
  const partials = dedupeNodes([
    node(partialId, "src/Partial.cs", 2),
    node(partialId, "src/Partial.impl.cs", 7),
  ]);
  TestValidator.equals(
    "partial declarations merge under one semantic id",
    partials.map((entry) => entry.id),
    [partialId],
  );
  TestValidator.equals(
    "the declaration/implementation policy preserves both partial locations",
    [partials[0]?.evidence?.file, partials[0]?.implementation?.file],
    ["src/Partial.cs", "src/Partial.impl.cs"],
  );

  const fallbackTypeScriptOverloads: ISamchonGraphNode[] = [
    {
      id: "src/app.ts#Service.run:method",
      kind: "method",
      language: "typescript",
      name: "run(text: string)",
      qualifiedName: "Service.run(text: string)",
      file: "src/app.ts",
      external: false,
      evidence: { file: "src/app.ts", startLine: 2 },
    },
    {
      id: "src/app.ts#Service.run:method",
      kind: "method",
      language: "typescript",
      name: "run(count: number)",
      qualifiedName: "Service.run(count: number)",
      file: "src/app.ts",
      external: false,
      evidence: { file: "src/app.ts", startLine: 3 },
    },
  ];
  assignSemanticIdentities(fallbackTypeScriptOverloads);
  TestValidator.notEquals(
    "generic TypeScript fallback overloads are distinct",
    fallbackTypeScriptOverloads[0]!.id,
    fallbackTypeScriptOverloads[1]!.id,
  );
  TestValidator.predicate(
    "a collided generic TypeScript fallback uses semantic ids",
    fallbackTypeScriptOverloads.every((node) => node.id.startsWith("@v2/")),
  );
  const canonicalTypeScript: ISamchonGraphNode = {
    id: "src/app.ts#run:function",
    kind: "function",
    language: "typescript",
    name: "run",
    file: "src/app.ts",
    external: false,
  };
  assignSemanticIdentities([canonicalTypeScript]);
  TestValidator.equals(
    "an unambiguous generic TypeScript fallback retains its canonical handle",
    canonicalTypeScript.id,
    "src/app.ts#run:function",
  );
  const unknown: ISamchonGraphNode = {
    id: "src/unknown#run:function",
    kind: "function",
    language: "unknown",
    name: "run",
    file: "src/unknown",
    external: false,
  };
  assignSemanticIdentities([unknown]);
  TestValidator.equals(
    "unknown-language declarations keep their legacy id",
    unknown.id,
    "src/unknown#run:function",
  );

  const owner: ISamchonGraphNode = {
    id: "src/Demo.java#Demo:class",
    kind: "class",
    language: "java",
    name: "Demo",
    file: "src/Demo.java",
    external: false,
    evidence: { file: "src/Demo.java", startLine: 1, endLine: 12 },
  };
  const overloaded = (name: string, line: number): ISamchonGraphNode => ({
    id: "src/Demo.java#Demo.run:method",
    kind: "method",
    language: "java",
    name,
    qualifiedName: `Demo.${name}`,
    file: "src/Demo.java",
    external: false,
    evidence: { file: "src/Demo.java", startLine: line, endLine: line + 1 },
  });
  const stringRun = overloaded("run(String)", 3);
  const intRun = overloaded("run(Int)", 7);
  const contains: ISamchonGraphEdge[] = [
    {
      from: owner.id,
      to: stringRun.id,
      kind: "contains",
      evidence: stringRun.evidence,
    },
    {
      from: owner.id,
      to: intRun.id,
      kind: "contains",
      evidence: intRun.evidence,
    },
  ];
  assignSemanticIdentities([owner, stringRun, intRun], contains);
  TestValidator.notEquals(
    "generic decorated overloads are distinct before dedupe",
    stringRun.id,
    intRun.id,
  );
  TestValidator.equals(
    "ambiguous legacy endpoints remap by their own evidence",
    contains.map((edge) => edge.to),
    [stringRun.id, intRun.id],
  );
  TestValidator.predicate(
    "generic persistent declarations use v2 ids",
    [owner.id, stringRun.id, intRun.id].every((id) => id.startsWith("@v2/")),
  );

  const undecorated = overloaded("run", 10);
  assignSemanticIdentities([undecorated]);
  TestValidator.predicate(
    "an undecorated generic callable is truthfully generation scoped",
    undecorated.id.startsWith("@g2/"),
  );
};

const identity = (
  input: Partial<IGraphSemanticIdentity> & Pick<IGraphSemanticIdentity, "symbol">,
): IGraphSemanticIdentity => ({
  version: 2,
  language: "java",
  role: "method",
  stability: "persistent",
  ...input,
});

const node = (
  id: string,
  file: string,
  startLine: number,
): ISamchonGraphNode => ({
  id,
  kind: "class",
  language: "csharp",
  name: "Partial",
  qualifiedName: "demo.Partial",
  file,
  external: false,
  evidence: { file, startLine, endLine: startLine + 2 },
});
