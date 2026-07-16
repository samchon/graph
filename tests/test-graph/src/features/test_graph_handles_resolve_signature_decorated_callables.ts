import { TestValidator } from "@nestia/e2e";
import {
  ISamchonGraphDump,
  SamchonGraphApplication,
  SamchonGraphMemory,
} from "@samchon/graph";

export const test_graph_handles_resolve_signature_decorated_callables =
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

    TestValidator.equals(
      "a fully decorated callable remains an exact handle",
      (await trace("Gson.toJson(Object)")).start?.id,
      "Gson.java#Gson.toJson(Object):method",
    );
    TestValidator.equals(
      "an owner-qualified callable base returns every overload",
      (await trace("Gson.toJson")).candidates?.map((node) => node.id),
      [
        "Gson.java#Gson.toJson(Object):method",
        "Gson.java#Gson.toJson(JsonElement):method",
      ],
    );
    TestValidator.equals(
      "a plain callable base also resolves decorated language-server names",
      (await trace("write")).start?.id,
      "JsonWriter.java#JsonWriter.write(String):method",
    );
    TestValidator.equals(
      "a file-qualified handle keeps its disambiguator for decorated callables",
      (await trace("repository.find")).start?.id,
      "repository.java#Repository.find(Query):method",
    );
    TestValidator.equals(
      "a second file-qualified handle does not leak the same callable base",
      (await trace("otherRepository.find")).start?.id,
      "otherRepository.java#OtherRepository.find(Query):method",
    );
    for (const handle of [
      "DBImpl.Get",
      "leveldb.DBImpl.Get",
      "leveldb::DBImpl::Get",
      "leveldb.DBImpl::Get",
    ]) {
      TestValidator.equals(
        `clangd mixed qualification resolves ${handle}`,
        (await trace(handle)).start?.id,
        "db/db_impl.cc#leveldb.DBImpl::Get:method",
      );
    }
  };

const dump = (): ISamchonGraphDump => ({
  project: "/gson",
  languages: ["java", "cpp"],
  indexer: "lsp",
  nodes: [
    callable("Gson.java", "Gson", "toJson(Object)"),
    callable("Gson.java", "Gson", "toJson(JsonElement)"),
    callable("JsonWriter.java", "JsonWriter", "write(String)"),
    callable("repository.java", "Repository", "find(Query)"),
    callable("otherRepository.java", "OtherRepository", "find(Query)"),
    {
      id: "db/db_impl.cc#leveldb.DBImpl::Get:method",
      kind: "method",
      language: "cpp",
      name: "DBImpl::Get",
      qualifiedName: "leveldb.DBImpl::Get",
      file: "db/db_impl.cc",
      external: false,
      evidence: {
        file: "db/db_impl.cc",
        startLine: 1121,
        endLine: 1129,
      },
    },
  ],
  edges: [],
});

const callable = (file: string, owner: string, name: string) => ({
  id: `${file}#${owner}.${name}:method`,
  kind: "method" as const,
  language: "java" as const,
  name,
  qualifiedName: `${owner}.${name}`,
  file,
  external: false,
  evidence: { file, startLine: 1, endLine: 2 },
});
