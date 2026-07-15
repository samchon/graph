import { ISamchonGraphNode } from "../structures";

/** True for dependency declarations outside the authored project graph. */
export function isExternalNode(node: ISamchonGraphNode): boolean {
  return (
    node.external ||
    node.file.startsWith("bundled://") ||
    /(^|\/)(node_modules|vendor|site-packages)\//.test(node.file)
  );
}
