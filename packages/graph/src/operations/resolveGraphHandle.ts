import { SamchonGraphMemory } from "../SamchonGraphMemory";
import { ISamchonGraphNode } from "../structures";
import { exportFanIn } from "./exportFanIn";
import { IResolvedGraphHandle } from "./IResolvedGraphHandle";
import { isSupportPath } from "./isSupportPath";

/**
 * Resolve a tool handle as an id, an exact symbol name, a dotted suffix, a
 * language-native qualified name, or a file-qualified name.
 *
 * A model writes handles from memory of an earlier result, and it writes them
 * the way the result read or the source language spells it. Several forms all
 * mean one node and all used to miss.
 *
 * - A `file#symbol` id whose file is one refactor stale (`effect.ts#track` for
 *   what now lives in `dep.ts`). The graph knows the symbol, so it answers
 *   rather than sending the caller back through a lookup.
 * - `renderer.render` — the file's stem and the symbol it declares. It is not a
 *   qualified name, so a suffix match on `.render` finds nothing and the caller
 *   gets an empty result for a symbol the graph holds. Vue's tour spent a trace
 *   call and four file reads on exactly this.
 * - A name the project declares more than once, which is not a name the project
 *   does not declare. The candidates come back ranked by what the package
 *   publishes, so the one a caller means is the one it reads first.
 * - `schema.parse` — a call written the way it is written in a program, on a
 *   value rather than on the type that declares it. There is no `schema` in the
 *   graph, so every exact form misses, and the handle resolves to nothing for a
 *   member the graph holds under `ZodType.parse`. It is how people name a
 *   method (`db.query`, `app.listen`, `repo.save`), so the member is what it
 *   means, and the candidates come back ranked when several classes declare
 *   it.
 * - `Handle::spawn` ??the Rust/C++ spelling of the dotted owner-qualified
 *   identity the cross-language graph stores as `Handle.spawn`. Rejecting that
 *   spelling silently turns an exact tour seed into loose text ranking.
 */
export function resolveGraphHandle(
  graph: SamchonGraphMemory,
  handle: string,
  candidateLimit = 12,
): IResolvedGraphHandle {
  const byId = graph.node(handle);
  if (byId !== undefined) return { node: byId };

  const forms = nativeQualifiedForms(handle);
  for (const form of forms) {
    const byName = resolveGraphName(graph, form, candidateLimit);
    if (byName.node !== undefined || byName.candidates !== undefined)
      return rank(graph, byName, candidateLimit);
  }

  for (const form of forms) {
    const byFile = resolveFileQualified(graph, form, candidateLimit);
    if (byFile.node !== undefined || byFile.candidates !== undefined)
      return rank(graph, byFile, candidateLimit);
  }

  for (const form of forms) {
    const symbol = symbolPartOf(form) ?? memberPartOf(form);
    if (symbol === undefined) continue;
    const resolved = resolveGraphName(graph, symbol, candidateLimit);
    if (resolved.node !== undefined || resolved.candidates !== undefined)
      return rank(graph, resolved, candidateLimit);
  }
  return {};
}

/** Keep exact graph spelling first, then try source-language `A::b` as `A.b`. */
function nativeQualifiedForms(handle: string): readonly string[] {
  if (!handle.includes("::")) return [handle];
  const dotted = handle.replaceAll("::", ".");
  return dotted === handle ? [handle] : [handle, dotted];
}

/**
 * The member a dotted handle names when its receiver is a value: the last
 * segment of `schema.parse`, of `this.store.commit`, of `db.query`.
 *
 * It is the last thing tried, after the whole handle has failed as an id, as a
 * qualified name, as a `.suffix`, and as a file-qualified name — so a receiver
 * that _is_ a type or a file never reaches here.
 */
function memberPartOf(handle: string): string | undefined {
  const dot = handle.lastIndexOf(".");
  if (dot <= 0) return undefined;
  const member = handle.slice(dot + 1);
  return member.length > 0 ? member : undefined;
}

/** The symbol an id-shaped handle names: `dir/file.ts#Class.method:kind`. */
function symbolPartOf(handle: string): string | undefined {
  const hash = handle.lastIndexOf("#");
  if (hash < 0) return undefined;
  const symbol = handle.slice(hash + 1);
  const kind = symbol.lastIndexOf(":");
  const name = kind < 0 ? symbol : symbol.slice(0, kind);
  return name.length > 0 ? name : undefined;
}

function resolveGraphName(
  graph: SamchonGraphMemory,
  name: string,
  candidateLimit: number,
): IResolvedGraphHandle {
  const exact = graph.symbols(name);
  if (exact.length === 1) return { node: exact[0] };
  if (exact.length > 1) return { candidates: exact.slice(0, candidateLimit) };

  // clangd can mix namespace dots with C++ member separators in one identity
  // (`leveldb.DBImpl::Get`), while callers naturally write either
  // `leveldb.DBImpl.Get` or `leveldb::DBImpl::Get`. Normalize both the handle
  // and clangd's stored spelling only after the graph's exact-name lane has
  // failed. Keeping this C++-only avoids changing dotted receiver semantics in
  // TypeScript, Java, C#, and the other language indexes.
  if (name.includes(".") || name.includes("::")) {
    const canonical = cppQualifiedForm(name);
    const suffix = `.${canonical}`;
    const cppMatches = graph.nodes.filter((node) => {
      if (node.language !== "cpp" || node.kind === "file") return false;
      const simple = cppQualifiedForm(node.name);
      const qualified = cppQualifiedForm(node.qualifiedName ?? "");
      return (
        simple === canonical ||
        qualified === canonical ||
        qualified.endsWith(suffix)
      );
    });
    if (cppMatches.length === 1) return { node: cppMatches[0] };
    if (cppMatches.length > 1)
      return { candidates: cppMatches.slice(0, candidateLimit) };
  }

  if (name.includes(".")) {
    const suffix = `.${name}`;
    const suffixMatches = graph.nodes.filter(
      (node) =>
        node.kind !== "file" && node.qualifiedName?.endsWith(suffix) === true,
    );
    if (suffixMatches.length === 1) return { node: suffixMatches[0] };
    if (suffixMatches.length > 1) {
      return { candidates: suffixMatches.slice(0, candidateLimit) };
    }
  }

  // JDT.LS and csharp-ls decorate callable symbol names with their parameter
  // list (`Gson.toJson(Object)`, `Logger.Write(LogEvent)`). A handle copied
  // from source or written from memory normally omits that list. Preserve the
  // decorated nodes so overloads stay distinct, but resolve the undecorated
  // callable base after every exact-name lane has failed.
  if (!name.includes("(")) {
    const suffix = name.includes(".") ? `.${name}` : undefined;
    const callables = graph.nodes.filter((node) => {
      if (!CALLABLE_KINDS.has(node.kind)) return false;
      const simple = callableBaseOf(node.name);
      const qualified = callableBaseOf(node.qualifiedName ?? "");
      if (simple === name || qualified === name) return true;
      return suffix !== undefined && qualified.endsWith(suffix);
    });
    if (callables.length === 1) return { node: callables[0] };
    if (callables.length > 1)
      return { candidates: callables.slice(0, candidateLimit) };
  }
  return {};
}

function cppQualifiedForm(name: string): string {
  return name.replaceAll("::", ".");
}

const CALLABLE_KINDS = new Set(["function", "method", "constructor"]);

function callableBaseOf(name: string): string {
  const open = name.indexOf("(");
  return open <= 0 ? name : name.slice(0, open).trimEnd();
}

/**
 * A `file.symbol` handle: the stem of the file a result cited, then the symbol
 * it declared there (`renderer.render`, `parse.safeParse`). It is how a model
 * disambiguates a common name from what the graph just showed it, and it names
 * exactly one node whenever that file declares the symbol.
 */
function resolveFileQualified(
  graph: SamchonGraphMemory,
  handle: string,
  candidateLimit: number,
): IResolvedGraphHandle {
  const dot = handle.indexOf(".");
  if (dot <= 0) return {};
  const stem = handle.slice(0, dot).toLowerCase();
  const name = handle.slice(dot + 1);
  if (name === "") return {};
  const matches = graph
    .symbols(name)
    .filter((node) => fileStem(node.file) === stem);
  if (matches.length === 1) return { node: matches[0] };
  if (matches.length > 1)
    return { candidates: matches.slice(0, candidateLimit) };

  // A language server may preserve a callable's parameter list in both the
  // simple and qualified names. The file portion is still the caller's
  // disambiguator, so apply the same undecorated callable comparison used by
  // resolveGraphName without widening the search beyond that file.
  if (!name.includes("(")) {
    const suffix = name.includes(".") ? `.${name}` : undefined;
    const callables = graph.nodes.filter((node) => {
      if (
        !CALLABLE_KINDS.has(node.kind) ||
        fileStem(node.file) !== stem
      )
        return false;
      const simple = callableBaseOf(node.name);
      const qualified = callableBaseOf(node.qualifiedName ?? "");
      return (
        simple === name ||
        qualified === name ||
        (suffix !== undefined && qualified.endsWith(suffix))
      );
    });
    if (callables.length === 1) return { node: callables[0] };
    if (callables.length > 1)
      return { candidates: callables.slice(0, candidateLimit) };
  }
  return {};
}

/** `packages/core/src/renderer.ts` -> `renderer`. */
function fileStem(file: string): string {
  const base = file.slice(file.lastIndexOf("/") + 1);
  return base.replace(/\.[^./]+$/, "").toLowerCase();
}

/**
 * Order candidates by how likely a caller means them: what the package
 * publishes first, then how much of the codebase leans on the node, with test
 * and fixture declarations last. An unranked list hands back whichever
 * declaration the graph happened to visit first — Vue's `render` came back as a
 * template pre-processor's method — and a caller that trusts the order traces
 * the wrong one.
 */
function rank(
  graph: SamchonGraphMemory,
  resolved: IResolvedGraphHandle,
  candidateLimit: number,
): IResolvedGraphHandle {
  if (resolved.candidates === undefined) return resolved;
  const ranked = [...resolved.candidates]
    .sort((a, b) => candidateScore(graph, b) - candidateScore(graph, a))
    .slice(0, candidateLimit);
  return { candidates: ranked };
}

function candidateScore(
  graph: SamchonGraphMemory,
  node: ISamchonGraphNode,
): number {
  let score = Math.min(48, Math.log2(1 + exportFanIn(graph, node.id)) * 20);
  if (node.exported) score += 12;
  if (node.external) score -= 60;
  if (isSupportPath(node.file)) score -= 30;
  const degree =
    graph.outgoing(node.id).length + graph.incoming(node.id).length;
  score += Math.min(24, Math.log2(1 + degree) * 6);
  return score;
}
