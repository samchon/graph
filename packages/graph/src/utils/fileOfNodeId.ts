/**
 * The source file a legacy node id names. A file node has no separator and is
 * returned unchanged.
 */
export function fileOfNodeId(id: string): string {
  return fileOfNodeId.parseLegacy(id)?.file ?? id;
}

export namespace fileOfNodeId {
  /** Components of a legacy `path#name:kind` graph identity. */
  export interface ILegacy {
    file: string;
    name: string;
    kind?: string;
  }

  /**
   * Decode the legacy graph identity without confusing a literal `#` or
   * backslash inside its path/name for a component boundary.
   */
  export function parseLegacy(id: string): ILegacy | undefined {
    const delimiter = hash(id);
    if (delimiter < 0) return undefined;
    const tail = id.slice(delimiter + 1);
    if (tail === "") return undefined;
    const colon = tail.lastIndexOf(":");
    if (colon === 0 || colon === tail.length - 1) return undefined;
    return {
      file: unescape(id.slice(0, delimiter)),
      name: unescape(colon < 0 ? tail : tail.slice(0, colon)),
      ...(colon < 0 ? {} : { kind: tail.slice(colon + 1) }),
    };
  }

  /** Encode a legacy graph identity with unambiguous component boundaries. */
  export function write(
    file: string,
    name: string,
    kind: string,
  ): string {
    return `${escape(file)}#${escape(name)}:${kind}`;
  }

  export function escape(value: string): string {
    return value.replaceAll("\\", "\\\\").replaceAll("#", "\\#");
  }

  export function unescape(value: string): string {
    let result = "";
    for (let index = 0; index < value.length; index++) {
      const next = value[index + 1];
      if (value[index] === "\\" && next !== undefined) {
        if (
          next === "#" ||
          (next === "\\" && !legacyUNCStart(value, index))
        ) {
          result += next;
          index++;
          continue;
        }
      }
      result += value[index];
    }
    return result;
  }

  export function hash(id: string): number {
    for (let index = 0; index < id.length; index++) {
      if (id[index] !== "#") continue;
      let slashes = 0;
      for (
        let slash = index - 1;
        slash >= 0 && id[slash] === "\\";
        slash--
      ) {
        slashes++;
      }
      if (slashes % 2 === 0) return index;
    }
    return -1;
  }
  /* c8 ignore start -- declaration merging emits an unreachable namespace
   * creation arm after the function object already exists. */
}
/* c8 ignore stop */

function legacyUNCStart(value: string, index: number): boolean {
  return (
    index === 0 &&
    value.length > 2 &&
    value[2] !== "\\" &&
    value[2] !== "#"
  );
}
