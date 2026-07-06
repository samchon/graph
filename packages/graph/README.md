# `@samchon/graph`

`@samchon/graph` is the language-neutral successor to `@ttsc/graph`.

It exposes one MCP tool, `inspect_code_graph`, that returns a bounded source-free index of a repository: declarations, source spans, imports, call/type edges, diagnostics when the language server can provide them, and a `next` contract that tells the agent whether to answer, inspect once more, leave the graph, or ask for clarification.

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

Start the client from the project root. The server builds one resident graph and answers all MCP calls from memory.

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

The default `auto` mode tries an LSP server when one is configured or found on `PATH`, then falls back to the static indexer if the server is missing or fails.

When a mixed-language repository has only some language servers available, the available LSP graphs are preserved and the failed languages are filled by the static fallback; the dump is marked as `hybrid` and carries warnings explaining which language fell back.

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

Static fallback handles declarations and imports for the same families and keeps the output useful even before language servers are installed.

The language servers are not bundled. Install the matching server in the target repository environment when compiler/LSP diagnostics and reference edges are required.

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

The source-linked design target is the same one described for `@ttsc/graph`: keep the graph as an index, make the agent select one request through a typed contract, and trust resolved compiler/LSP facts enough to stop reading files after graph evidence answers the question.

The source layout follows the `@ttsc/graph` file discipline: one TypeScript file may define and export only one top-level symbol, and the filename must exactly match that symbol. Files that only re-export other files are the only exception.

The e2e suite scans `packages/graph/src/**/*.ts` and `test/src/**/*.ts` and fails when this convention is broken.

## Verification

The repository is a pnpm workspace with `packages/graph` for the published package and `test` for e2e coverage.

```bash
pnpm install
pnpm build
pnpm test
pnpm coverage
```

The e2e suite covers:

- every advertised language through static fallback fixtures;
- every graph node kind, edge kind, and request branch through a contract graph;
- the MCP stdio server and CLI dump command;
- the LSP JSON-RPC path through a fake language server, including diagnostics, references, missing-server fallback, and per-language hybrid fallback;
- the actual `@samchon/graph` repository as a real-codebase fixture.

GitHub Actions runs build, e2e, and coverage gates on Linux, Windows, and macOS for every push and pull request to `master`.
