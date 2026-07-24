import { TestValidator } from "@nestia/e2e";
import {
  ISamchonGraphDump,
  SamchonGraphMemory,
  semanticGraphNodeId,
} from "@samchon/graph";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { GraphPaths } from "../internal/GraphPaths";

export const test_legacy_semantic_identity_handles_remain_resolvable =
  async () => {
    const { resolveGraphHandle } = await importLib<{
      resolveGraphHandle: (
        graph: SamchonGraphMemory,
        handle: string,
      ) => {
        node?: ISamchonGraphDump.INode;
        candidates?: ISamchonGraphDump.INode[];
      };
    }>("operations/resolveGraphHandle.js");
    const stringId = callableId("String");
    const integerId = callableId("Integer");
    const partialId = semanticGraphNodeId(
      {
        version: 2,
        language: "csharp",
        symbol: "Demo.Partial",
        role: "class",
        native: { key: "T:Demo.Partial", stability: "semantic" },
        stability: "persistent",
      },
      "Demo.Partial",
    );
    const graph = SamchonGraphMemory.from({
      project: "/demo",
      languages: ["java", "csharp", "typescript"],
      indexer: "hybrid",
      nodes: [
        callable(stringId, "toJson(String)"),
        callable(integerId, "toJson(Integer)"),
        {
          id: partialId,
          kind: "class",
          language: "csharp",
          name: "Partial",
          qualifiedName: "Demo.Partial",
          file: "src/Partial.cs",
          external: false,
          evidence: { startLine: 2, endLine: 4 },
          implementation: {
            file: "src/Partial.impl.cs",
            startLine: 8,
            endLine: 12,
          },
        },
        {
          id: "src/legacy.ts#legacy:function",
          kind: "function",
          language: "typescript",
          name: "legacy",
          file: "src/legacy.ts",
          external: false,
        },
      ],
      edges: [],
    });

    TestValidator.equals(
      "an exact decorated v1 handle resolves its v2 node",
      resolveGraphHandle(graph, "Gson.java#Gson.toJson(String):method").node?.id,
      stringId,
    );
    TestValidator.equals(
      "an undecorated v1 overload handle returns deterministic candidates",
      resolveGraphHandle(graph, "Gson.java#Gson.toJson:method").candidates?.map(
        (node) => node.id,
      ),
      [stringId, integerId].sort(),
    );
    for (const file of ["src/Partial.cs", "src/Partial.impl.cs"]) {
      TestValidator.equals(
        `a partial declaration's ${file} legacy handle reaches one node`,
        resolveGraphHandle(graph, `${file}#Demo.Partial:class`).node?.id,
        partialId,
      );
    }
    TestValidator.equals(
      "a legacy dump id remains an exact current handle",
      resolveGraphHandle(graph, "src/legacy.ts#legacy:function").node?.id,
      "src/legacy.ts#legacy:function",
    );
  };

const importLib = <T>(relative: string): Promise<T> =>
  import(
    pathToFileURL(path.join(GraphPaths.graphPackageRoot, "lib", relative)).href
  ) as Promise<T>;

const callableId = (parameter: string): string =>
  semanticGraphNodeId(
    {
      version: 2,
      language: "java",
      symbol: "Gson.toJson",
      role: "method",
      native: { key: "+1", stability: "positional" },
      overload: `parameters=${parameter}`,
      stability: "persistent",
    },
    `Gson.toJson(${parameter})`,
  );

const callable = (id: string, name: string): ISamchonGraphDump.INode => ({
  id,
  kind: "method",
  language: "java",
  name,
  qualifiedName: `Gson.${name}`,
  file: "Gson.java",
  external: false,
  evidence: { startLine: 1, endLine: 2 },
});
