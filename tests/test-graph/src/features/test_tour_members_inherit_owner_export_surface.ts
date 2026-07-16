import { TestValidator } from "@nestia/e2e";
import {
  ISamchonGraphDump,
  SamchonGraphApplication,
  SamchonGraphMemory,
} from "@samchon/graph";

export const test_tour_members_inherit_owner_export_surface = async () => {
  for (const language of ["csharp", "java"] as const) {
    const graph = SamchonGraphMemory.from(dump(language));
    const output = await new SamchonGraphApplication(graph).inspect_code_graph({
      question: "Show the central runtime flow.",
      draft: {
        reason: "A tour is the smallest request for the central runtime flow.",
        type: "tour",
      },
      review: "Tour is appropriate for ranking the central runtime flow.",
      request: {
        type: "tour",
        reinterpretations: [],
        limit: 1,
        includeTests: false,
      },
    });
    if (output.result.type !== "tour")
      throw new Error(`Expected a tour result, got ${output.result.type}.`);

    TestValidator.equals(
      `${language} members inherit their owner's graph export surface`,
      output.result.entrypoints.map((node) => node.name),
      ["Api.Hidden"],
    );
  }
};

const dump = (language: "csharp" | "java"): ISamchonGraphDump => {
  const file = language === "csharp" ? "Api.cs" : "Api.java";
  const owner = `${file}#Api:class`;
  const methods = [
    { name: "Run", modifiers: ["public"] as const, calls: 3 },
    { name: "Hidden", modifiers: ["private"] as const, calls: 9 },
    { name: "Extension", modifiers: ["protected"] as const, calls: 9 },
    ...(language === "csharp"
      ? [{ name: "AssemblyOnly", modifiers: ["internal"] as const, calls: 9 }]
      : [{ name: "PackageOnly", modifiers: [] as const, calls: 9 }]),
  ];
  return {
    project: `/${language}`,
    languages: [language],
    indexer: "lsp",
    nodes: [
      {
        id: owner,
        kind: "class",
        language,
        name: "Api",
        file,
        external: false,
        exported: true,
        evidence: { startLine: 1, endLine: 2 },
      },
      ...methods.map((method, index) => ({
        id: `${file}#Api.${method.name}:method`,
        kind: "method" as const,
        language,
        name: `Api.${method.name}`,
        qualifiedName: `Api.${method.name}`,
        file,
        external: false,
        ...(method.modifiers.length > 0
          ? { modifiers: [...method.modifiers] }
          : {}),
        evidence: { startLine: 3 + index * 10, endLine: 8 + index * 10 },
      })),
      ...methods.flatMap((method) =>
        Array.from({ length: method.calls }, (_, index) => ({
          id: `${method.name}/step${index}.${language}#work${index}:function`,
          kind: "function" as const,
          language,
          name: `${method.name}Work${index}`,
          file: `${method.name}/step${index}.${language}`,
          external: false,
          evidence: { startLine: 1, endLine: 2 },
        })),
      ),
    ],
    edges: [
      { from: file, to: owner, kind: "exports" },
      ...methods.map((method) => ({
        from: owner,
        to: `${file}#Api.${method.name}:method`,
        kind: "contains" as const,
      })),
      ...methods.flatMap((method, methodIndex) =>
        Array.from({ length: method.calls }, (_, index) => ({
          from: `${file}#Api.${method.name}:method`,
          to: `${method.name}/step${index}.${language}#work${index}:function`,
          kind: "calls" as const,
          evidence: { startLine: 4 + methodIndex * 10 + index },
        })),
      ),
    ],
  };
};
