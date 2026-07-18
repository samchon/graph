import { TestValidator } from "@nestia/e2e";
import {
  ISamchonGraphDump,
  SamchonGraphApplication,
  SamchonGraphMemory,
} from "@samchon/graph";

/**
 * A handle that names more than one node is not a handle the project does not
 * declare: the resolver returns the matches as ranked candidates rather than a
 * miss. This covers the two ambiguous forms the single-match tests do not -- a
 * clangd `Owner::member` spelling shared by several C++ files, and a
 * `file.Owner.member` whose callables keep their parameter list only in the
 * qualified spelling -- including the same-name member that carries no qualified
 * spelling of its own, which the qualified comparison must walk without failing.
 */
export const test_graph_handles_rank_ambiguous_qualified_and_file_callable_forms =
  async () => {
    const graph = SamchonGraphMemory.from(dump());
    const app = new SamchonGraphApplication(graph);
    const trace = async (from: string) => {
      const output = await app.inspect_code_graph({
        question: `Trace ${from}.`,
        draft: {
          reason: "A forward trace is the smallest request for this handle.",
          type: "trace",
        },
        review: "Trace is appropriate for resolving and following this handle.",
        request: { type: "trace", from, direction: "forward" },
      });
      if (output.result.type !== "trace")
        throw new Error(`Expected a trace result, got ${output.result.type}.`);
      return output.result;
    };
    const candidateIds = async (from: string): Promise<string[]> =>
      ((await trace(from)).candidates ?? []).map((node) => node.id).sort();

    TestValidator.equals(
      "an ambiguous clangd :: handle returns every qualified match as a candidate",
      await candidateIds("DBImpl::Get"),
      ["leveldb/db.cc#Get:method", "rocksdb/db.cc#Get:method"],
    );

    TestValidator.equals(
      "a file-qualified callable suffix returns ranked candidates when ambiguous",
      await candidateIds("repo.Service.find"),
      ["repo.java#find.a:method", "repo.java#find.b:method"],
    );
  };

const dump = (): ISamchonGraphDump => ({
  project: "/workspace",
  languages: ["cpp", "java"],
  indexer: "lsp",
  nodes: [
    {
      id: "leveldb/db.cc#Get:method",
      kind: "method",
      language: "cpp",
      name: "Get",
      qualifiedName: "leveldb.DBImpl::Get",
      file: "leveldb/db.cc",
      external: false,
      evidence: { file: "leveldb/db.cc", startLine: 1, endLine: 2 },
    },
    {
      id: "rocksdb/db.cc#Get:method",
      kind: "method",
      language: "cpp",
      name: "Get",
      qualifiedName: "rocksdb.DBImpl::Get",
      file: "rocksdb/db.cc",
      external: false,
      evidence: { file: "rocksdb/db.cc", startLine: 1, endLine: 2 },
    },
    // A same-name C++ method with no qualified spelling: it must not match the
    // `DBImpl::Get` handle, and its absent qualified name must not break the
    // qualified comparison that walks every C++ candidate.
    {
      id: "cache/db.cc#Get:method",
      kind: "method",
      language: "cpp",
      name: "Get",
      file: "cache/db.cc",
      external: false,
      evidence: { file: "cache/db.cc", startLine: 1, endLine: 2 },
    },
    {
      id: "repo.java#find.a:method",
      kind: "method",
      language: "java",
      name: "find(Query)",
      qualifiedName: "app.Service.find(Query)",
      file: "repo.java",
      external: false,
      evidence: { file: "repo.java", startLine: 1, endLine: 2 },
    },
    {
      id: "repo.java#find.b:method",
      kind: "method",
      language: "java",
      name: "find(Query)",
      qualifiedName: "lib.Service.find(Query)",
      file: "repo.java",
      external: false,
      evidence: { file: "repo.java", startLine: 1, endLine: 2 },
    },
  ],
  edges: [],
});
