import { TestValidator } from "@nestia/e2e";
import { buildGraphDump, ISamchonGraphDump } from "@samchon/graph";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";

export const test_csharp_static_and_lsp_preserve_language_semantics = async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "samchon-graph-csharp-semantics-"),
  );
  fs.writeFileSync(
    path.join(root, "Pipeline.cs"),
    [
      "namespace Demo.Core;",
      "",
      "public interface ISink",
      "{",
      "    void Emit(Event evt);",
      "}",
      "",
      "public sealed class Event {}",
      "",
      "internal class InternalSink : ISink",
      "{",
      "    public InternalSink() {}",
      "",
      "    public void Emit(Event evt)",
      "    {",
      "        foreach (var item in Array.Empty<int>())",
      "        {",
      "            var accepted = item > 0;",
      "        }",
      "    }",
      "",
      "    private void Helper() {}",
      "    protected void ProtectedHelper() {}",
      "    void DefaultPrivate() {}",
      "}",
      "",
      "public sealed class Logger",
      "{",
      "    private readonly ISink _sink;",
      "    public Logger(ISink sink) { _sink = sink; }",
      "    public void Write(Event evt) { _sink.Emit(evt); }",
      "    internal void AssemblyHelper() {}",
      "    public bool Enabled",
      "    {",
      "        get",
      "        {",
      "            CallFromGetter();",
      "            return true;",
      "        }",
      "    }",
      "}",
      "",
      "public record Route(string Name);",
      "public delegate void Routed(Event evt);",
      "",
    ].join("\n"),
  );

  const staticDump = await buildGraphDump({
    cwd: root,
    mode: "static",
    languages: ["csharp"],
  });
  validate("static", staticDump);

  const lspDump = await buildGraphDump({
    cwd: root,
    mode: "lsp",
    languages: ["csharp"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer, "--csharp-symbols"],
    lspReferenceLimit: 0,
  });
  TestValidator.equals("C# fake server stays in the LSP lane", lspDump.indexer, "lsp");
  validate("lsp", lspDump);

  const flatDump = await buildGraphDump({
    cwd: root,
    mode: "lsp",
    languages: ["csharp"],
    server: process.execPath,
    serverArgs: [
      GraphPaths.fakeLspServer,
      "--csharp-symbols",
      "--symbol-information",
    ],
    lspReferenceLimit: 0,
  });
  validate("lsp", flatDump);
  TestValidator.equals(
    "flat C# SymbolInformation restores class-default private visibility",
    flatDump.nodes.find((node) =>
      (node.qualifiedName ?? node.name).startsWith(
        "Demo.Core.InternalSink.DefaultPrivate",
      ),
    )?.modifiers,
    ["private"],
  );
  TestValidator.predicate(
    "flat C# variable symbols recover source-owned field and property kinds",
    flatDump.nodes.some(
      (node) =>
        node.qualifiedName === "Demo.Core.Logger._sink" &&
        node.kind === "field",
    ) &&
      flatDump.nodes.some(
        (node) =>
          node.qualifiedName === "Demo.Core.Logger.Enabled" &&
          node.kind === "property",
      ),
  );
};

function validate(lane: "static" | "lsp", dump: ISamchonGraphDump): void {
  const named = (qualifiedName: string) =>
    dump.nodes.find((node) => {
      const identity = node.qualifiedName ?? node.name;
      // csharp-ls includes the parameter signature in callable symbol names;
      // the static lane has only the declared name. Both identify this same
      // declaration for the language-semantics assertions below.
      return identity === qualifiedName || identity.startsWith(`${qualifiedName}(`);
    });
  const hasEdge = (kind: string, from: string, to: string) =>
    dump.edges.some(
      (edge) =>
        edge.kind === kind &&
        edge.from === named(from)?.id &&
        edge.to === named(to)?.id,
    );
  const label = (fact: string) => `${lane}: ${fact}`;

  TestValidator.predicate(
    label("a dotted file-scoped namespace owns its declarations"),
    named("Demo.Core")?.kind === "namespace" &&
      named("Demo.Core.Logger")?.kind === "class" &&
      hasEdge("contains", "Demo.Core", "Demo.Core.Logger"),
  );
  TestValidator.predicate(
    label("normal return-type methods and constructors keep their kinds"),
    named("Demo.Core.Logger.Write")?.kind === "method" &&
      named("Demo.Core.Logger.Logger")?.kind === "constructor" &&
      named("Demo.Core.InternalSink.Emit")?.kind === "method" &&
      named("Demo.Core.InternalSink.InternalSink")?.kind === "constructor",
  );
  TestValidator.predicate(
    label("records, delegates, fields, and properties survive indexing"),
    named("Demo.Core.Route")?.kind === "class" &&
      named("Demo.Core.Routed")?.kind === "type" &&
      named("Demo.Core.Logger._sink")?.kind === "field" &&
      named("Demo.Core.Logger.Enabled")?.kind === "property",
  );
  TestValidator.predicate(
    label("method and property bodies do not become declarations"),
    dump.nodes.every(
      (node) =>
        !["foreach", "accepted", "CallFromGetter"].includes(node.name),
    ),
  );
  TestValidator.predicate(
    label("a class-to-interface base relation is implements"),
    hasEdge(
      "implements",
      "Demo.Core.InternalSink",
      "Demo.Core.ISink",
    ) &&
      !hasEdge("extends", "Demo.Core.InternalSink", "Demo.Core.ISink"),
  );

  for (const name of ["ISink", "Event", "Logger", "Route", "Routed"]) {
    TestValidator.equals(
      label(`public top-level type ${name} is exported`),
      named(`Demo.Core.${name}`)?.exported,
      true,
    );
  }
  TestValidator.equals(
    label("the namespace is structural, not an exported declaration"),
    named("Demo.Core")?.exported,
    undefined,
  );
  TestValidator.equals(
    label("an internal top-level type is not exported"),
    named("Demo.Core.InternalSink")?.exported,
    undefined,
  );
  TestValidator.equals(
    label("members are not module exports"),
    named("Demo.Core.Logger.Write")?.exported,
    undefined,
  );

  TestValidator.equals(
    label("an interface member has public visibility by default"),
    named("Demo.Core.ISink.Emit")?.modifiers,
    ["public"],
  );
  TestValidator.equals(
    label("a public member records public visibility"),
    named("Demo.Core.Logger.Write")?.modifiers,
    ["public"],
  );
  TestValidator.equals(
    label("a private readonly field keeps both modifiers"),
    named("Demo.Core.Logger._sink")?.modifiers,
    ["private", "readonly"],
  );
  TestValidator.equals(
    label("a private helper records private visibility"),
    named("Demo.Core.InternalSink.Helper")?.modifiers,
    ["private"],
  );
  TestValidator.equals(
    label("a protected helper records protected visibility"),
    named("Demo.Core.InternalSink.ProtectedHelper")?.modifiers,
    ["protected"],
  );
  TestValidator.equals(
    label("an implicit class member records private visibility"),
    named("Demo.Core.InternalSink.DefaultPrivate")?.modifiers,
    ["private"],
  );
}
