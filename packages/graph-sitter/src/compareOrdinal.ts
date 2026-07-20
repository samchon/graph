/**
 * Compare text in canonical ECMAScript ordinal order.
 *
 * This deliberately compares UTF-16 code units instead of consulting the
 * host locale: graph identities, capped file discovery, and publications must
 * be byte-identical on every supported host.
 */
export function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
