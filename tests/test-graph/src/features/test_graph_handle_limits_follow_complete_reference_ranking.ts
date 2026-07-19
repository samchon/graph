import { TestValidator } from "@nestia/e2e";
import {
  ISamchonGraphNode,
  SamchonGraphMemory,
} from "@samchon/graph";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { GraphPaths } from "../internal/GraphPaths";

export const test_graph_handle_limits_follow_complete_reference_ranking =
  async () => {
    const { resolveGraphHandle } = await importLib<{
      resolveGraphHandle: (
        graph: SamchonGraphMemory,
        handle: string,
        candidateLimit?: number,
      ) => { candidates?: ISamchonGraphNode[] };
    }>("operations/resolveGraphHandle.js");

    const exact = candidates("Shared", "class");
    assertWinner(
      resolveGraphHandle(memory(exact), "Shared"),
      exact[12]!.id,
      12,
      "exact names rank their complete set before limiting",
    );

    const fileQualified = candidates("Thing", "class", {
      file: () => "shared.ts",
    });
    assertWinner(
      resolveGraphHandle(memory(fileQualified), "shared.Thing"),
      fileQualified[12]!.id,
      12,
      "file-qualified names rank their complete set before limiting",
    );

    const memberFallback = candidates("run", "method", {
      qualifiedName: (index) => `Service${String(index)}.run`,
    });
    assertWinner(
      resolveGraphHandle(memory(memberFallback), "client.run"),
      memberFallback[12]!.id,
      12,
      "value-member fallback ranks its complete set before limiting",
    );

    const stale = candidates("Moved", "class");
    assertWinner(
      resolveGraphHandle(memory(stale), "src/old.ts#Moved:class"),
      stale[12]!.id,
      12,
      "stale-id fallback ranks its complete set before limiting",
    );

    const suffix = candidates("run", "method", {
      qualifiedName: (index) => `Outer${String(index)}.Inner.run`,
    });
    assertWinner(
      resolveGraphHandle(memory(suffix), "Inner.run"),
      suffix[12]!.id,
      12,
      "qualified suffixes rank their complete set before limiting",
    );

    const bounded = candidates("Bounded", "class", { count: 5 });
    for (const [limit, length] of [
      [0, 0],
      [1, 1],
      [3, 3],
      [5, 5],
      [8, 5],
    ] as const) {
      const resolved = resolveGraphHandle(memory(bounded), "Bounded", limit);
      TestValidator.equals(
        `candidate limit ${String(limit)} caps only the ranked response`,
        resolved.candidates?.length,
        length,
      );
      if (length > 0) {
        TestValidator.equals(
          `candidate limit ${String(limit)} preserves the strongest match`,
          resolved.candidates?.[0]?.id,
          bounded[4]!.id,
        );
      }
    }

    const tied = ["c", "a", "b"].map((letter) => ({
      id: `src/${letter}.ts#Tied:class`,
      kind: "class" as const,
      language: "typescript" as const,
      name: "Tied",
      file: `src/${letter}.ts`,
      external: false,
    }));
    const expected = [
      "src/a.ts#Tied:class",
      "src/b.ts#Tied:class",
      "src/c.ts#Tied:class",
    ];
    for (const order of [tied, [...tied].reverse()]) {
      TestValidator.equals(
        "equal relevance uses stable graph identity rather than visit order",
        resolveGraphHandle(memory(order), "Tied", 3).candidates?.map(
          (node) => node.id,
        ),
        expected,
      );
    }
  };

function candidates(
  name: string,
  kind: "class" | "method",
  options: {
    count?: number;
    file?: (index: number) => string;
    qualifiedName?: (index: number) => string;
  } = {},
): ISamchonGraphNode[] {
  return Array.from({ length: options.count ?? 13 }, (_, index) => {
    const file = options.file?.(index) ?? `src/item-${String(index)}.ts`;
    return {
      id: `${file}#${options.qualifiedName?.(index) ?? name}:${kind}`,
      kind,
      language: "typescript",
      name,
      ...(options.qualifiedName === undefined
        ? {}
        : { qualifiedName: options.qualifiedName(index) }),
      file,
      external: false,
      ...(index === (options.count ?? 13) - 1 ? { exported: true } : {}),
    };
  });
}

function memory(nodes: ISamchonGraphNode[]): SamchonGraphMemory {
  return SamchonGraphMemory.from({
    project: "C:/synthetic-graph",
    languages: ["typescript"],
    indexer: "lsp",
    nodes,
    edges: [],
  });
}

function assertWinner(
  resolved: { candidates?: ISamchonGraphNode[] },
  winner: string,
  length: number,
  label: string,
): void {
  TestValidator.equals(`${label}: bounded length`, resolved.candidates?.length, length);
  TestValidator.equals(`${label}: strongest first`, resolved.candidates?.[0]?.id, winner);
}

const importLib = <T>(relative: string): Promise<T> =>
  import(
    pathToFileURL(path.join(GraphPaths.graphPackageRoot, "lib", relative)).href
  ) as Promise<T>;
