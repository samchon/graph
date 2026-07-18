import { TestValidator } from "@nestia/e2e";
import { buildGraphDump, ISamchonGraphDump } from "@samchon/graph";
import fs from "node:fs";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";

export const test_ruby_preserves_end_scopes_method_names_and_visibility = async () => {
  const root = GraphPaths.createTempDirectory("samchon-graph-ruby-semantics-");
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

  const statically = await buildGraphDump({
    cwd: root,
    mode: "static",
    languages: ["ruby"],
  });
  validate("static", statically);

  const lsp = await buildGraphDump({
    cwd: root,
    mode: "lsp",
    languages: ["ruby"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer, "--ruby-symbols"],
    lspReferenceLimit: 0,
  });
  TestValidator.equals("Ruby fake server stays in the LSP lane", lsp.indexer, "lsp");
  validate("lsp", lsp);

  await validateLexicalLiterals();
};

async function validateLexicalLiterals(): Promise<void> {
  const root = GraphPaths.createTempDirectory("samchon-graph-ruby-literals-");
  fs.writeFileSync(
    path.join(root, "literals.rb"),
    [
      "module LexicalData",
      "  class Guard",
      '    STRING = "class module def if unless case begin while until for do end"',
      "    SINGLE = 'class module def if unless case begin while until for do end'",
      '    FAKE_HEREDOC = "<<TEXT class module def end"',
      "    ESCAPED = /if\\/end/",
      '    INTERPOLATED = /[a-z]#{"/"}(?:if|end)/',
      "    MULTILINE_REGEXP = /if",
      "      end/",
      '    MULTILINE_STRING = "if',
      '      end"',
      "    PERCENT_REGEXP = %r{end { nested }}",
      "    PERCENT_TEXT = %q!end!",
      "    MULTILINE_PERCENT = %Q{",
      "      if class module def end",
      "=begin",
      "      if class module def end",
      "=end",
      "    }",
      "    DOCUMENT = <<~TEXT",
      "      if end class module def",
      "    TEXT",
      "=begin",
      "      if end class module def",
      "=end",
      "",
      "    def divide(total, divisor, factor)",
      "      total / divisor / factor",
      "    end",
      "",
      "    def after_division",
      "      :ok",
      "    end",
      "",
      "    def consume_literals",
      "      match /end/ do",
      "        :value",
      "      end",
      "      %q{outer { end }}",
      "      %q!\\! end!",
      "      %Q(#{')'} end)",
      "      %r<#{'>'}end>",
      "      %w[end]",
      "      %W{#{'}'} end}",
      "      %i(end)",
      "      %I{#{'}'} end}",
      "      %x!printf end!",
      "      %s|end|",
      "    end",
      "",
      "    class << self",
      "      def compile!",
      "        %r{class end}",
      "      end",
      "    end",
      "",
      "    private",
      "",
      "    def hidden?",
      "      /end/.match?(STRING)",
      "    end",
      "",
      "    public",
      "",
      "    def finish",
      "      :done # class module def if end",
      "    end",
      "  end",
      "end",
      "",
    ].join("\n"),
  );

  const dump = await buildGraphDump({
    cwd: root,
    mode: "static",
    languages: ["ruby"],
  });
  const named = (name: string) =>
    dump.nodes.find((node) => (node.qualifiedName ?? node.name) === name);
  const guard = named("LexicalData.Guard");
  const methods = [
    "divide",
    "after_division",
    "consume_literals",
    "compile!",
    "hidden?",
    "finish",
  ];

  TestValidator.predicate(
    "static: Ruby literal keywords do not close declaration scopes",
    guard?.kind === "class" &&
      methods.every(
        (name) => named(`LexicalData.Guard.${name}`)?.kind === "method",
      ) &&
      dump.nodes.every(
        (node) =>
          !methods.some((name) =>
            node.id.includes(`LexicalData.Guard.${name}.`),
          ),
      ),
  );
  TestValidator.predicate(
    "static: slash division and every Ruby percent literal preserve later siblings",
    guard !== undefined &&
      methods.every((name) =>
        dump.edges.some(
          (edge) =>
            edge.kind === "contains" &&
            edge.from === guard.id &&
            edge.to === named(`LexicalData.Guard.${name}`)?.id,
        ),
      ),
  );
  TestValidator.equals(
    "static: singleton and visibility facts survive surrounding literals",
    [
      named("LexicalData.Guard.compile!")?.modifiers,
      named("LexicalData.Guard.hidden?")?.modifiers,
      named("LexicalData.Guard.finish")?.modifiers,
    ],
    [["public", "static"], ["private"], ["public"]],
  );
}

function validate(lane: "static" | "lsp", dump: ISamchonGraphDump): void {
  const named = (qualifiedName: string) =>
    dump.nodes.find(
      (node) => (node.qualifiedName ?? node.name) === qualifiedName,
    );
  const label = (fact: string) => `${lane}: ${fact}`;
  const router = named("Demo.Router");

  TestValidator.predicate(
    label("module and class end scopes own each method exactly once"),
    named("Demo")?.kind === "module" &&
      router?.kind === "class" &&
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
  TestValidator.predicate(
    label("Ruby blocks, locals, and singleton-class syntax are not declarations"),
    dump.nodes.every(
      (node) =>
        !["if", "ready", "handler", "self"].includes(node.name) &&
        !node.id.includes("call.dispatch") &&
        !node.id.includes("dispatch!.route"),
    ),
  );
  TestValidator.predicate(
    label("the class contains instance, singleton, endless, and one-line methods"),
    router !== undefined &&
      [
        "call",
        "dispatch!",
        "route!",
        "process_route",
        "compile?",
        "hidden_builder=",
        "build!",
        "put",
      ].every((name) =>
        dump.edges.some(
          (edge) =>
            edge.kind === "contains" &&
            edge.from === router.id &&
            edge.to === named(`Demo.Router.${name}`)?.id,
        ),
      ),
  );

  TestValidator.equals(
    label("Ruby visibility and singleton modifiers survive indexing"),
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
  TestValidator.equals(
    label("only the Ruby declarations on the public surface are exported"),
    [
      named("Demo")?.exported,
      router?.exported,
      named("Demo.Router.call")?.exported,
      named("Demo.Router.dispatch!")?.exported,
      named("Demo.Router.process_route")?.exported,
      named("Demo.Router.build!")?.exported,
    ],
    [true, true, true, undefined, undefined, true],
  );

  if (lane === "static") {
    const calls = (from: string, to: string) =>
      dump.edges.some(
        (edge) =>
          edge.kind === "calls" &&
          edge.from === named(`Demo.Router.${from}`)?.id &&
          edge.to === named(`Demo.Router.${to}`)?.id,
      );
    TestValidator.predicate(
      "static: punctuation-bearing Ruby calls retain the runtime chain",
      calls("call", "dispatch!") &&
        calls("dispatch!", "route!") &&
        calls("route!", "process_route") &&
        calls("build!", "compile?"),
    );
  }
}
