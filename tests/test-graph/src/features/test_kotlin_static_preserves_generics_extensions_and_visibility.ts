import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";
import fs from "node:fs";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";

export const test_kotlin_static_preserves_generics_extensions_and_visibility =
  async () => {
    const root = GraphPaths.createTempDirectory("samchon-graph-kotlin-semantics-");
    fs.writeFileSync(
      path.join(root, "Resolution.kt"),
      [
        "package demo",
        "",
        "annotation class Marker",
        "@Deprecated(",
        "    message = \"old\",",
        "    replaceWith = ReplaceWith(\"Marker\"),",
        ")",
        "class Annotated",
        "@Suppress(\"unused\") class InlineAnnotated",
        "/*",
        "fun ghostFromBlockComment()",
        "*/",
        "val snippet = \"\"\"",
        "fun ghostFromRawString()",
        "\"\"\"",
        "enum class Lifetime {",
        "    SINGLE, FACTORY;",
        "    fun cached(): Boolean = this == SINGLE",
        "}",
        "sealed interface Resolver {",
        "    fun <T : Any> resolve(type: Any): T",
        "    fun clear()",
        "}",
        "interface ChildResolver :",
        "    Resolver",
        "data class Definition(val lifetime: Lifetime)",
        "",
        "class Scope internal constructor(",
        "    private val resolver: Resolver,",
        ") {",
        "    inline fun <reified T : Any> get(",
        "        qualifier: String? = null,",
        "    ): T = resolve(T::class, qualifier)",
        "",
        "    private fun <T : Any> resolve(",
        "        type: Any,",
        "        qualifier: String?,",
        "    ): T = TODO()",
        "",
        "    internal val registry: MutableMap<String, Definition> = mutableMapOf()",
        "    fun locals() {",
        "        val localDefinition = Definition(Lifetime.FACTORY)",
        "    }",
        "",
        "    companion object {",
        "        fun root(resolver: Resolver): Scope = Scope(resolver)",
        "    }",
        "}",
        "",
        "class Koin(val root: Scope)",
        "val Koin.defaultScope: Scope get() = root",
        "object GlobalResolver",
        "class NamedCompanion {",
        "    companion object Factory {",
        "        fun make(): NamedCompanion = NamedCompanion()",
        "    }",
        "}",
        "",
        "inline fun <reified T : Any> Koin.inject(",
        "    qualifier: String? = null,",
        "): Lazy<T> = lazy { root.get<T>(qualifier) }",
        "",
        "internal fun hiddenResolver(): Resolver = TODO()",
        "private val secretDefinition = Definition(Lifetime.SINGLE)",
        "val defaultDefinition = Definition(Lifetime.FACTORY)",
        "",
      ].join("\n"),
    );

    const dump = await buildGraphDump({
      cwd: root,
      mode: "static",
      languages: ["kotlin"],
    });
    const named = (qualifiedName: string) =>
      dump.nodes.find(
        (node) => (node.qualifiedName ?? node.name) === qualifiedName,
      );

    TestValidator.equals(
      "Kotlin declaration forms keep their graph kinds",
      [
        named("Marker")?.kind,
        named("Annotated")?.kind,
        named("InlineAnnotated")?.kind,
        named("Lifetime")?.kind,
        named("Resolver")?.kind,
        named("ChildResolver")?.kind,
        named("Definition")?.kind,
        named("Scope")?.kind,
        named("Scope.get")?.kind,
        named("Scope.resolve")?.kind,
        named("Scope.registry")?.kind,
        named("Resolver.resolve")?.kind,
        named("Resolver.clear")?.kind,
        named("Lifetime.cached")?.kind,
        named("Scope.Companion")?.kind,
        named("Scope.Companion.root")?.kind,
        named("GlobalResolver")?.kind,
        named("defaultScope")?.kind,
        named("NamedCompanion.Factory")?.kind,
        named("NamedCompanion.Factory.make")?.kind,
        named("inject")?.kind,
        named("defaultDefinition")?.kind,
      ],
      [
        "class",
        "class",
        "class",
        "enum",
        "interface",
        "interface",
        "class",
        "class",
        "method",
        "method",
        "property",
        "method",
        "method",
        "method",
        "class",
        "method",
        "class",
        "variable",
        "class",
        "method",
        "function",
        "variable",
      ],
    );
    TestValidator.equals(
      "Kotlin default and explicit visibility survive static indexing",
      [
        named("Scope")?.modifiers,
        named("Scope.get")?.modifiers,
        named("Scope.resolve")?.modifiers,
        named("Scope.registry")?.modifiers,
        named("hiddenResolver")?.modifiers,
        named("secretDefinition")?.modifiers,
        named("defaultDefinition")?.modifiers,
        named("defaultScope")?.modifiers,
        named("Scope.locals.localDefinition")?.modifiers,
      ],
      [
        ["public"],
        ["public"],
        ["private"],
        ["internal"],
        ["internal"],
        ["private"],
        ["public"],
        ["public"],
        undefined,
      ],
    );
    TestValidator.equals(
      "only Kotlin top-level public declarations seed the exported surface",
      [
        named("Scope")?.exported,
        named("Scope.get")?.exported,
        named("inject")?.exported,
        named("hiddenResolver")?.exported,
        named("secretDefinition")?.exported,
        named("defaultDefinition")?.exported,
        named("defaultScope")?.exported,
      ],
      [true, undefined, true, undefined, undefined, true, true],
    );
    TestValidator.predicate(
      "generic methods and properties remain directly owned by their class",
      ["get", "resolve", "registry"].every((name) =>
        dump.edges.some(
          (edge) =>
            edge.kind === "contains" &&
            edge.from === named("Scope")?.id &&
            edge.to === named(`Scope.${name}`)?.id,
        ),
      ),
    );
    TestValidator.predicate(
      "bodyless interface methods do not absorb the declaration after them",
      ["resolve", "clear"].every((name) =>
        dump.edges.some(
          (edge) =>
            edge.kind === "contains" &&
            edge.from === named("Resolver")?.id &&
            edge.to === named(`Resolver.${name}`)?.id,
        ),
      ) && named("Resolver.resolve.clear") === undefined,
    );
    TestValidator.predicate(
      "multiline Kotlin supertypes remain connected",
      dump.edges.some(
        (edge) =>
          edge.kind === "extends" &&
          edge.from === named("ChildResolver")?.id &&
          edge.to === named("Resolver")?.id,
      ),
    );
    TestValidator.equals(
      "Kotlin extension functions use the callable name, not the receiver name",
      dump.nodes.filter((node) => node.name === "inject").length,
      1,
    );
    TestValidator.equals(
      "comments and raw strings cannot manufacture declarations",
      dump.nodes.filter((node) => node.name.startsWith("ghostFrom")).length,
      0,
    );
  };
