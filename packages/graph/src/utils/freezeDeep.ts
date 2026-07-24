/**
 * Seal one already-validated tree in place so no retained reference can edit it.
 *
 * A trust boundary that validates a value and then hands the same object back
 * has not fenced anything: whoever kept the reference can change it afterwards,
 * and the check that passed no longer describes what the graph publishes. This
 * closes that by freezing the tree rather than copying it. A copy would fence
 * the same reference just as well, but a whole-workspace snapshot is exactly the
 * value that must not be duplicated once per publication, and the walk here
 * allocates nothing but its own visited set.
 *
 * It is iterative and remembers what it visited, so a cycle terminates and a
 * shared subtree is walked once instead of once per parent. An accessor is
 * rejected rather than frozen, because `Object.freeze` fixes which getter runs
 * and not what the getter returns — a value that recomputes itself on every read
 * is the very channel this seal exists to close. `Map` is unsealed by freezing
 * for the same reason and is handled explicitly; no other exotic collection
 * appears in the contracts this guards, so none is given a silent pass here.
 */
export function freezeDeep<T>(value: T, subject: string): T {
  const seen = new WeakSet<object>();
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || typeof current !== "object") continue;
    const target: object = current;
    if (seen.has(target)) continue;
    seen.add(target);
    if (target instanceof Map) {
      for (const mutator of MAP_MUTATORS) {
        Object.defineProperty(target, mutator, {
          value: refuseMutation,
          writable: false,
          enumerable: false,
          configurable: false,
        });
      }
      for (const [key, entry] of target) pending.push(key, entry);
    }
    for (const key of Reflect.ownKeys(target)) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key)!;
      if (!("value" in descriptor)) {
        throw new TypeError(
          `@samchon/graph: ${subject} cannot expose an accessor property`,
        );
      }
      pending.push(descriptor.value);
    }
    Object.freeze(target);
  }
  return value;
}

function refuseMutation(): never {
  throw new TypeError(
    "@samchon/graph: a sealed collection cannot be modified",
  );
}

const MAP_MUTATORS: readonly string[] = ["set", "delete", "clear"];
