/**
 * Split an identifier or phrase into lowercase subword tokens: CamelCase,
 * snake, dotted, and space boundaries all break, so `getHTTPResponse`,
 * `find_by_id`, and `OrderService.create` tokenize the way a query would.
 */
export function subwords(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
}
