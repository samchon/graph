/**
 * What a graph node represents.
 *
 * The symbol kinds (`file` through `constructor`) are declarations the language
 * server owns and resolves. `external_symbol` is a dependency-boundary leaf the
 * workspace references but does not declare. The graph keeps it as a named
 * endpoint without walking into the dependency's internals.
 *
 * Used as the `kind` discriminant on {@link ISamchonGraphNode}.
 */
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
