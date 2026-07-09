import { ISamchonGraphEvidence } from "./ISamchonGraphEvidence";

/**
 * A decorator as written on a declaration, carried on the decorated
 * {@link ISamchonGraphNode}'s `decorators`.
 *
 * The graph reports the decorator faithfully rather than interpreting any
 * framework's convention: the `name` is the decorator as written (`Controller`,
 * `Get`, `TypedRoute.Get`, ...), and statically resolvable literal arguments
 * are preserved so a consumer can apply its own meaning without re-parsing
 * source.
 */
export interface ISamchonGraphDecorator {
  /**
   * The decorator name as written, qualified through its access path:
   * `Controller`, `Get`, `TypedRoute.Get`, `MessagePattern`.
   */
  name: string;

  /** The literal call arguments, in source order. Empty for a bare decorator. */
  arguments?: string[];

  /** The decorator expression span, for display. */
  evidence?: ISamchonGraphEvidence;
}
