/**
 * The relationship a directed edge encodes between two {@link ISamchonGraphNode}s.
 *
 * Structural edges (`contains`, `exports`, `imports`) come from the declaration
 * pass. Value and type edges (`calls`, `accesses`, `instantiates`, `type_ref`,
 * `extends`, `implements`, `overrides`, `renders`) are resolved by the language
 * server — `renders` is a component use. `decorates` carries a decorator fact
 * and `tests` a test-to-subject relationship.
 */
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
  | "decorates"
  | "renders"
  | "tests"
  | "references";
