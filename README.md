# `@samchon/graph`

`@samchon/graph` is the language-neutral successor to `@ttsc/graph`.

It exposes one MCP tool, `inspect_code_graph`, that returns a bounded source-free
index of a repository: declarations, source spans, imports, call/type edges,
diagnostics when the language server can provide them, and a `next` contract that
tells the agent whether to answer, inspect once more, leave the graph, or ask for
clarification.

The package follows the `@ttsc/graph` architecture:

- one tool, not a garden of narrow tools;
- required `question`, `draft`, and `review` fields before the request branch;
- graph evidence only, never source bodies;
- compiler/LSP truth when available;
- static indexing fallback when no language server is installed.

## Install

```bash
npm install -D @samchon/graph
```

Add it to an MCP client:

```json
{
  "mcpServers": {
    "samchon-graph": {
      "command": "npx",
      "args": ["-y", "@samchon/graph"]
    }
  }
}
```

Start the client from the project root. The server builds one resident graph and
answers all MCP calls from memory.

## CLI

```bash
# Start the MCP server over stdio
npx @samchon/graph

# Print the graph dump as JSON
npx @samchon/graph dump --cwd .

# Force static indexing
npx @samchon/graph dump --mode static

# Force LSP indexing for one language
npx @samchon/graph dump --language go --mode lsp --server gopls
```

The default `auto` mode tries an LSP server when one is configured or found on
`PATH`, then falls back to the static indexer if the server is missing or fails.

## Supported Language Defaults

The built-in registry knows the usual file extensions and server commands for:

- TypeScript / JavaScript: `typescript-language-server --stdio`
- Go: `gopls`
- Rust: `rust-analyzer`
- C / C++: `clangd`
- Java: `jdtls`
- C#: `csharp-ls`
- Kotlin: `kotlin-language-server`
- Swift: `sourcekit-lsp`
- Scala: `metals`
- Zig: `zls`

Static fallback handles declarations and imports for the same families and keeps
the output useful even before language servers are installed.

## Programmatic API

```ts
import { buildGraph, SamchonGraphApplication } from "@samchon/graph";

const graph = await buildGraph({ cwd: process.cwd(), mode: "auto" });
const app = new SamchonGraphApplication(graph);
const result = app.inspect_code_graph({
  question: "What are the main entrypoints?",
  draft: { reason: "Broad orientation needs a tour.", type: "tour" },
  review: "A tour is the smallest source-free answer.",
  request: { type: "tour" },
});
```

## Design Notes

The source-linked design target is the same one described for `@ttsc/graph`:
keep the graph as an index, make the agent select one request through a typed
contract, and trust resolved compiler/LSP facts enough to stop reading files
after graph evidence answers the question.
