/**
 * The relationship a directed edge encodes between two {@link ISamchonGraphNode}s.
 *
 * Structural edges (`contains`, `exports`, `imports`) come from the declaration
 * pass. Value and type edges (`calls`, `accesses`, `instantiates`, `type_ref`,
 * `extends`, `implements`, `overrides`, `renders`) are resolved by the language
 * server — `renders` is a component use. `decorates` carries a decorator fact
 * and `tests` a test-to-subject relationship.
 *
 * `dispatches` is the runtime counterpart of `overrides`/`implements`: the
 * language server resolves a call to the declaration it names, and where that
 * declaration is abstract or an interface member, the code that runs is its
 * implementation. It carries the implementation's declaration span, and a
 * traversal that follows what executes emits it in place of the dead end.
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
  | "dispatches"
  | "decorates"
  | "renders"
  | "tests"
  | "references";
