import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";
import fs from "node:fs";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";

const rubyFixture = (): string => {
  const root = GraphPaths.createTempDirectory("samchon-ruby-flat-");
  fs.writeFileSync(
    path.join(root, "router.rb"),
    [
      "module Demo",
      "  class Router",
      "    def call(env)",
      "      dispatch!()",
      "    end",
      "",
      "    private",
      "",
      "    def dispatch!",
      "      route!",
      "    end",
      "",
      "    public",
      "",
      "    def route!",
      "      process_route() { |handler| handler.call }",
      "    end",
      "",
      "    protected",
      "",
      "    def process_route",
      "      if ready?",
      "        yield -> {}",
      "      end",
      "    end",
      "",
      "    public",
      "",
      "    def self.compile?(path)",
      "      path",
      "    end",
      "",
      "    class << self",
      "      private",
      "",
      "      def hidden_builder=(value)",
      "        @builder = value",
      "      end",
      "",
      "      public",
      "",
      "      def build!(path) = compile?(path)",
      "    end",
      "",
      "    def put(path, &block) route(\"PUT\", path, &block) end",
      "  end",
      "end",
      "",
    ].join("\n"),
  );
  return root;
};

export const test_ruby_visibility_survives_the_flat_symbol_shape = async () => {
  const root = rubyFixture();

  // `hierarchicalDocumentSymbolSupport` is advertised, not guaranteed: a Ruby
  // server such as Solargraph may still answer `documentSymbol` with the flat
  // SymbolInformation shape, which carries no modifier fields and states
  // ownership only through `containerName`. Every visibility fact then has to
  // be recovered from the source, keyed by each declaration's own line — the
  // same facts the hierarchical shape would have carried inline. A graph that
  // only recovered them in the hierarchical shape would publish a private
  // method as consumer API to whichever caller happened to get the flat reply.
  const dump = await buildGraphDump({
    cwd: root,
    mode: "lsp",
    languages: ["ruby"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer, "--ruby-symbols", "--symbol-information"],
    lspReferenceLimit: 0,
  });
  TestValidator.equals("the flat Ruby symbols come from the server", dump.indexer, "lsp");

  const named = (qualifiedName: string) =>
    dump.nodes.find(
      (node) => (node.qualifiedName ?? node.name) === qualifiedName,
    );

  // Ownership survives the flat shape: a method owned only by `containerName`
  // is filed under its class, not read back as a second top-level declaration.
  TestValidator.predicate(
    "the flat shape keeps the module, class, and every method",
    named("Demo")?.kind === "module" &&
      named("Demo.Router")?.kind === "class" &&
      [
        "call",
        "dispatch!",
        "route!",
        "process_route",
        "compile?",
        "hidden_builder=",
        "build!",
        "put",
      ].every((name) => named(`Demo.Router.${name}`)?.kind === "method"),
  );

  // The visibility keyword that governs each method — including the singleton
  // (`self.`) and `class << self` forms — is read from the declaration's line,
  // exactly as it is in the hierarchical shape.
  TestValidator.equals(
    "flat Ruby methods recover their visibility and singleton modifiers",
    [
      named("Demo.Router.call")?.modifiers,
      named("Demo.Router.dispatch!")?.modifiers,
      named("Demo.Router.route!")?.modifiers,
      named("Demo.Router.process_route")?.modifiers,
      named("Demo.Router.compile?")?.modifiers,
      named("Demo.Router.hidden_builder=")?.modifiers,
      named("Demo.Router.build!")?.modifiers,
      named("Demo.Router.put")?.modifiers,
    ],
    [
      ["public"],
      ["private"],
      ["public"],
      ["protected"],
      ["public", "static"],
      ["private", "static"],
      ["public", "static"],
      ["public"],
    ],
  );

  // Only the declarations on the public surface are exported, and a private or
  // protected method never is — the flat reply must not widen that surface.
  TestValidator.equals(
    "the flat shape publishes only the public Ruby surface",
    [
      named("Demo")?.exported,
      named("Demo.Router")?.exported,
      named("Demo.Router.call")?.exported,
      named("Demo.Router.dispatch!")?.exported,
      named("Demo.Router.process_route")?.exported,
      named("Demo.Router.build!")?.exported,
    ],
    [true, true, true, undefined, undefined, true],
  );
};
