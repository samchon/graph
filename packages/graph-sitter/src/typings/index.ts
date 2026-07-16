/** Languages whose source syntax the best-effort extractor recognizes. */
export type GraphLanguage =
  | "typescript"
  | "go"
  | "rust"
  | "cpp"
  | "c"
  | "java"
  | "csharp"
  | "kotlin"
  | "swift"
  | "scala"
  | "zig"
  | "python"
  | "ruby"
  | "php"
  | "lua"
  | "dart"
  | "unknown";

/** Languages with an actual syntax extractor implementation. */
export type GraphSitterLanguage = Exclude<GraphLanguage, "unknown">;

/** Canonical runtime registry for narrowing project languages at the adapter. */
export const GRAPH_SITTER_LANGUAGES: readonly GraphSitterLanguage[] = [
  "typescript",
  "go",
  "rust",
  "cpp",
  "c",
  "java",
  "csharp",
  "kotlin",
  "swift",
  "scala",
  "zig",
  "python",
  "ruby",
  "php",
  "lua",
  "dart",
];

const GRAPH_SITTER_LANGUAGE_SET = new Set<string>(GRAPH_SITTER_LANGUAGES);

/** True when the value names a syntax extractor implemented by this package. */
export function isGraphSitterLanguage(
  value: string,
): value is GraphSitterLanguage {
  return GRAPH_SITTER_LANGUAGE_SET.has(value);
}

/** Declaration and structural-container kinds emitted by graph-sitter. */
export type GraphNodeKind =
  | "file"
  | "package"
  | "namespace"
  | "module"
  | "function"
  | "class"
  | "interface"
  | "type"
  | "enum"
  | "variable"
  | "method"
  | "property"
  | "parameter"
  | "field"
  | "constructor"
  | "external_symbol";

/** Relationship kinds emitted by graph-sitter and shared graph derivations. */
export type GraphEdgeKind =
  | "contains"
  | "exports"
  | "imports"
  | "calls"
  | "accesses"
  | "instantiates"
  | "type_ref"
  | "extends"
  | "implements"
  | "overrides"
  | "dispatches"
  | "decorates"
  | "renders"
  | "tests"
  | "references";

/** Source-level modifiers the extractor can preserve without type checking. */
export type SamchonGraphNodeModifier =
  | "export"
  | "default"
  | "declare"
  | "abstract"
  | "static"
  | "readonly"
  | "async"
  | "const"
  | "public"
  | "private"
  | "protected"
  | "internal"
  | "optional";
