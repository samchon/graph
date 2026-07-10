// Array spread (`push(...items)`) passes every element as a call argument and
// blows the call stack on the item counts a real language server can produce —
// the Dart analysis server emitted enough diagnostics on the flutter tree to
// crash the whole build. Append by loop, which has no such limit.
export function appendAll<T>(target: T[], items: readonly T[]): void {
  for (const item of items) target.push(item);
}
