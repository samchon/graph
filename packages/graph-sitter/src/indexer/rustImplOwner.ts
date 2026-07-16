/**
 * The nominal owner of a rust-analyzer `impl ...` document-symbol container.
 *
 * An impl block is not a declaration node, but its children must retain the
 * concrete receiver in their qualified names. Prefer a type declared in the
 * same file (including the inner `Handle` in `impl Schedule for Arc<Handle>`);
 * otherwise retain the compact self type so unrelated external targets still
 * cannot collapse.
 */
export function rustImplOwner(
  name: string,
  declaredTypes: ReadonlySet<string>,
): string | undefined {
  const prefix = /^(?:unsafe\s+)?impl(?=\s|<)/.exec(name);
  if (prefix === null) return undefined;
  let body = name.slice(prefix[0].length).trimStart();
  if (body.startsWith("<")) {
    const end = matchingAngle(body);
    /* c8 ignore next 2 -- malformed impl labels are not emitted by rust-analyzer */
    if (end === undefined) return undefined;
    body = body.slice(end + 1).trimStart();
  }
  const trait = /\s+for\s+/g;
  let selfType = body;
  for (let match = trait.exec(body); match !== null; match = trait.exec(body)) {
    selfType = body.slice(match.index + match[0].length);
  }
  selfType = selfType.replace(/\s+where\s+[\s\S]*$/, "").trim();
  /* c8 ignore next -- malformed impl labels are not emitted by rust-analyzer */
  if (selfType === "") return undefined;

  const identifiers = selfType.match(/[A-Za-z_][\w]*/g) ?? [];
  const declared = identifiers.find((identifier) => declaredTypes.has(identifier));
  return declared ?? selfType.replace(/\s+/g, "");
}

/** Index of the `>` matching a leading Rust generic-parameter `<`. */
function matchingAngle(text: string): number | undefined {
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "<") depth++;
    else if (text[index] === ">") {
      depth--;
      if (depth === 0) return index;
    }
  }
  /* c8 ignore next -- guarded by rust-analyzer's valid impl label */
  return undefined;
}
