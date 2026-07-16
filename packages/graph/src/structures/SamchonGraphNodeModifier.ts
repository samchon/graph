/**
 * A declaration modifier carried on a symbol {@link ISamchonGraphNode}, when the
 * declaration pass records it. Used by projections that reason about visibility
 * and shape — e.g. a public-API overview filters on `export`, a class outline
 * separates `static` members.
 */
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
