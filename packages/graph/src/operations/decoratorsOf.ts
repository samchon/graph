import { ISamchonGraphDecorator, ISamchonGraphNode } from "../structures";

/** Decorator facts already captured on a node, omitted when absent. */
export function decoratorsOf(
  node: ISamchonGraphNode,
): ISamchonGraphDecorator[] | undefined {
  return node.decorators !== undefined && node.decorators.length > 0
    ? node.decorators
    : undefined;
}
