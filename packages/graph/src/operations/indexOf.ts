import { ISamchonGraphDump } from "../structures";

/** What the index for a result actually is, in one clause. */
export function indexOf(indexer: ISamchonGraphDump["indexer"]): string {
  return INDEX_OF[indexer];
}

const INDEX_OF: Record<ISamchonGraphDump["indexer"], string> = {
  lsp: "the language server's own index of this project",
  static:
    "the declarations and relationships indexed from this project's own source",
  hybrid:
    "this project's combined index — the language server's own resolution for the languages one is installed for, and the source-built index for the rest",
};
