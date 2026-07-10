import { GraphLanguage } from "../typings/GraphLanguage";
import { GraphNodeKind } from "../typings/GraphNodeKind";
import { ISamchonGraphDecorator } from "./ISamchonGraphDecorator";
import { ISamchonGraphEvidence } from "./ISamchonGraphEvidence";
import { SamchonGraphNodeModifier } from "./SamchonGraphNodeModifier";

/**
 * One node in the graph: a declared symbol or a structural container (file,
 * package).
 *
 * The `id` is position-invariant: `path#qualifiedName:kind` (e.g.
 * `src/order.ts#OrderService.create:method`), so inserting a line above a
 * declaration does not re-key it. Line and span live in `evidence` and are
 * never part of identity.
 */
export interface ISamchonGraphNode {
  /** Position-invariant identity (see the interface doc for the id grammar). */
  id: string;

  /** What this node represents. */
  kind: GraphNodeKind;

  /** The source language this node was declared in. */
  language: GraphLanguage;

  /** The simple, unqualified declared name (`create`, `OrderService`, `App`). */
  name: string;

  /**
   * The owner-qualified name, when the node lives inside another declaration:
   * `OrderService.create`, `Shopping.ISale`. Absent for a top-level
   * declaration.
   */
  qualifiedName?: string;

  /** Project-relative path of the file that declares this node. */
  file: string;

  /**
   * True when the declaration lives outside the workspace (a dependency). The
   * graph keeps the leaf as a named endpoint but does not walk into its
   * internals.
   */
  external: boolean;

  /**
   * True when `file` is git-ignored generated code (a Prisma client, a codegen
   * output). Projections desurface these so generated nodes do not bury the
   * authored graph.
   */
  ignored?: boolean;

  /** True when the symbol is part of its module's export surface. */
  exported?: boolean;

  /** Declaration modifiers, when the declaration pass recorded any. */
  modifiers?: SamchonGraphNodeModifier[];

  /**
   * The decorators written on this declaration, in source order, when it has
   * any: raw decorator facts (`@Controller`, `@Get`) a consumer can interpret
   * without re-parsing source.
   */
  decorators?: ISamchonGraphDecorator[];

  /** The declaration span, for display and signatures. */
  evidence?: ISamchonGraphEvidence;

  /**
   * The implementation span when a callable/property member is implemented by a
   * function assignment separate from its declaration.
   */
  implementation?: ISamchonGraphEvidence;
}
