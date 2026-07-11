import path from "node:path";
import {
  DocumentSymbolResult,
  IDocumentSymbol,
  ILocation,
  isDocumentSymbol,
  ISymbolInformation,
  LspClient,
} from "../lsp";
import { isTestPath } from "../operations/isTestPath";
import { ISamchonGraphDiagnostic, ISamchonGraphEdge, ISamchonGraphNode } from "../structures";
import { GraphLanguage, GraphNodeKind } from "../typings";
import { projectRelative } from "../utils/fs";
import { fileFromUri, fileUri, isSubPath } from "../utils/path";
import { appendAll } from "./appendAll";
import { decoratorsAbove } from "./decoratorsAbove";
import { IBuildGraphOptions } from "./IBuildGraphOptions";
import { ILspSession } from "./ILspSession";
import { overrideEdges } from "./overrideEdges";
import { resolveType } from "./resolveType";
import { supertypesOf } from "./supertypesOf";

export async function scanSession(
  session: ILspSession,
  options: IBuildGraphOptions,
): Promise<{
  nodes: ISamchonGraphNode[];
  edges: ISamchonGraphEdge[];
  diagnostics: ISamchonGraphDiagnostic[];
  warnings: string[];
}> {
  const { client, root, language } = session;
  const opened = [...session.opened.entries()].map(([rel, entry]) => ({
    abs: entry.abs,
    rel,
    text: entry.text,
  }));
  const nodes: ISamchonGraphNode[] = [];
  const byFile = new Map<string, ISamchonGraphNode[]>();
  for (const openedFile of opened) {
    const symbols = await client.request<DocumentSymbolResult>(
      "textDocument/documentSymbol",
      { textDocument: { uri: fileUri(openedFile.abs) } },
    );
    const converted = convertSymbols(
      language,
      openedFile.rel,
      symbols,
      openedFile.text,
    );
    byFile.set(openedFile.rel, converted);
    appendAll(nodes, converted);
  }

  const linesByFile = new Map<string, string[]>();
  for (const openedFile of opened) {
    linesByFile.set(openedFile.rel, openedFile.text.split(/\r?\n/));
  }

  const edges: ISamchonGraphEdge[] = [];
  const referenceLimit = options.lspReferenceLimit ?? 250;
  // When the reference budget is smaller than the symbol count, spend it on
  // product code first: test files (spec callbacks and the like) otherwise
  // crowd out the API surface an agent actually asks about.
  const referenceTargets = [...nodes]
    .sort((a, b) => Number(isTestPath(a.file)) - Number(isTestPath(b.file)))
    .slice(0, referenceLimit);
  // Language servers build their cross-file reference index lazily — often on
  // the FIRST `textDocument/references` call, not during the initial
  // `$/progress` indexing wait above. So warm the index with one patient
  // request before firing the batch: once it exists, every later request is
  // served from the server's cache in milliseconds. Firing the whole batch
  // cold instead makes every request race the same one-time build and time
  // out (ruby-lsp on a fresh project is the pathological case). Results stay
  // indexed by target order to keep edge output deterministic.
  const referenceParams = (target: ISamchonGraphNode): unknown => {
    const evidence = target.evidence!;
    return {
      textDocument: { uri: fileUri(path.join(root, target.file)) },
      position: {
        line: evidence.startLine - 1,
        character: Math.max(0, evidence.startCol! - 1),
      },
      context: { includeDeclaration: false },
    };
  };
  const referenceResults: (ILocation[] | null)[] = new Array(
    referenceTargets.length,
  ).fill(null);
  // Only after the warmup request actually returns is the server proven able
  // to answer references; a timeout even under the patient budget means it
  // cannot, so we keep the structural graph and skip the rest rather than
  // grinding the full batch.
  let referencesUnavailable = false;
  if (referenceTargets.length > 0) {
    const warm = await safeReferences(
      client,
      referenceParams(referenceTargets[0]!),
      options.lspWarmupTimeoutMs ?? 180_000,
    );
    if (warm === "timeout") referencesUnavailable = true;
    else referenceResults[0] = warm;
  }
  if (!referencesUnavailable && referenceTargets.length > 1) {
    const rest = await mapWithConcurrency(
      referenceTargets.slice(1),
      options.lspConcurrency ?? 16,
      async (target) => {
        const refs = await safeReferences(client, referenceParams(target));
        return refs === "timeout" ? null : refs;
      },
    );
    for (let index = 0; index < rest.length; index++) {
      referenceResults[index + 1] = rest[index]!;
    }
  }
  for (let index = 0; index < referenceTargets.length; index++) {
    const target = referenceTargets[index]!;
    const refs = referenceResults[index];
    for (const ref of refs ?? []) {
      const refFile = fileFromUri(ref.uri);
      if (!isSubPath(root, refFile)) continue;
      const rel = projectRelative(root, refFile);
      const owners = byFile.get(rel);
      if (owners === undefined) continue;
      const fileLines = linesByFile.get(rel);
      // The language server reports a reference range whose start is the AST
      // node's full-start (leading whitespace and comments included), not the
      // token's real start, so advance past that trivia — the same correction
      // @ttsc/graph's own dump applies (dump.go firstCodeOffset) before it uses
      // a node position. Without it the classifier reads the character before
      // the identifier (a space, `.`, `<`, ...) and the evidence points one
      // column early.
      const start = firstCodeAt(
        fileLines,
        ref.range.start.line,
        ref.range.start.character,
      );
      const owner = ownerAt(owners, start.line + 1);
      if (owner === undefined || owner.id === target.id) continue;
      const startLineText = fileLines?.[start.line];
      const endLineText =
        ref.range.end.line === start.line
          ? startLineText
          : fileLines?.[ref.range.end.line];
      const accessText = accessExpressionAt(endLineText, ref.range.end.character);
      const kind = referenceKind(
        target.kind,
        startLineText,
        endLineText,
        start.character,
        ref.range.end.character,
        ref.range.end.line !== start.line,
        accessText,
      );
      const evidence = {
        file: rel,
        startLine: start.line + 1,
        startCol: start.character + 1,
        endLine: ref.range.end.line + 1,
        endCol: ref.range.end.character + 1,
        // Not part of the public evidence contract; an internal hint
        // `accessAliasesFor` reads via `edgeEvidenceTextOf`.
        ...(accessText !== undefined ? { text: accessText } : {}),
      };
      const emit = (kindToEmit: ISamchonGraphEdge["kind"]): void => {
        edges.push({ from: owner.id, to: target.id, kind: kindToEmit, evidence });
        // A non-method class/interface member (a property or an arrow-
        // function-valued field) attributes its body's references to both
        // itself AND the enclosing class/interface, not one or the other --
        // confirmed against @ttsc/graph's own fact-builder (forEachMember
        // walks a property member's subtree once for the member, once for its
        // container). A method is attributed solely to itself.
        if (owner.kind === "property" || owner.kind === "field" || owner.kind === "variable") {
          const container = containerAt(owners, start.line + 1);
          if (
            container !== undefined &&
            container.id !== owner.id &&
            container.id !== target.id
          ) {
            edges.push({ from: container.id, to: target.id, kind: kindToEmit, evidence });
          }
        }
      };
      emit(kind);
      // A namespaced JSX tag (`<A.B.C />`) is both a render and a member-
      // access chain reaching the component, so @ttsc/graph's AST walk emits
      // a render AND an access edge to the same target; mirror the extra
      // access when the render's tag name is dotted.
      if (kind === "renders" && accessText !== undefined && accessText.includes(".")) {
        emit("accesses");
      }
    }
  }

  // Make the document-symbol hierarchy explicit: every nested symbol is
  // contained by its owner. The owner is the node whose path is this node's
  // qualified name without its last segment.
  const nodeByPath = new Map<string, ISamchonGraphNode>();
  for (const node of nodes) {
    nodeByPath.set(`${node.file}\0${node.qualifiedName ?? node.name}`, node);
  }
  for (const node of nodes) {
    if (node.qualifiedName === undefined) continue;
    const parent = nodeByPath.get(
      `${node.file}\0${node.qualifiedName.slice(0, node.qualifiedName.lastIndexOf("."))}`,
    );
    if (parent === undefined) continue;
    edges.push({
      from: parent.id,
      to: node.id,
      kind: "contains",
      evidence: node.evidence,
    });
  }

  // Inheritance: language servers do not report supertypes uniformly, so parse the
  // declaration line the same way the static indexer does and resolve the
  // supertypes against the symbols the server did report.
  const byName = new Map<string, ISamchonGraphNode[]>();
  for (const node of nodes) {
    const list = byName.get(node.name);
    if (list === undefined) byName.set(node.name, [node]);
    else list.push(node);
  }
  for (const node of nodes) {
    if (node.kind !== "class" && node.kind !== "interface") continue;
    const line = linesByFile.get(node.file)![node.evidence!.startLine - 1]!.trim();
    const seen = new Set<string>();
    for (const supertype of supertypesOf(line)) {
      const target = resolveType(supertype.name, node, byName);
      if (target === undefined) continue;
      const key = `${supertype.relation}\0${target.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        from: node.id,
        to: target.id,
        kind: supertype.relation,
        evidence: node.evidence,
      });
    }
  }
  // Decorators sit on the lines directly above a declaration; link the
  // decorated symbol to the decorator it names.
  for (const node of nodes) {
    const fileLines = linesByFile.get(node.file)!;
    for (const name of decoratorsAbove(
      fileLines,
      node.evidence!.startLine - 1,
    )) {
      const target = resolveType(name, node, byName);
      if (target === undefined) continue;
      edges.push({
        from: node.id,
        to: target.id,
        kind: "decorates",
        evidence: node.evidence,
      });
    }
  }
  appendAll(edges, overrideEdges(nodes, edges));

  return {
    nodes,
    edges,
    diagnostics: [...session.diagnostics],
    warnings: [
      ...(nodes.length > referenceLimit
        ? [`${language}: reference collection capped at ${referenceLimit} symbols.`]
        : []),
      ...(referencesUnavailable
        ? [`${language}: server did not answer references within the warmup budget; kept structural edges only.`]
        : []),
    ],
  };
}

// Advance a (line, character) position past leading trivia — whitespace, `//`
// line comments, and `/* */` block comments — to the first code character at
// or after it, crossing line boundaries. Ports @ttsc/graph's dump.go
// firstCodeOffset: the language server reports a reference's start as the AST
// node full-start (trivia included), so this recovers the token's real start.
function firstCodeAt(
  lines: readonly string[] | undefined,
  line: number,
  character: number,
): { line: number; character: number } {
  // Every caller passes the file's own cached lines, so this is defensive.
  /* c8 ignore next */
  if (lines === undefined) return { line, character };
  let l = line;
  let c = character;
  let inBlock = false;
  while (l < lines.length) {
    const text = lines[l]!;
    while (c < text.length) {
      if (inBlock) {
        if (text[c] === "*" && text[c + 1] === "/") {
          inBlock = false;
          c += 2;
        } else c++;
        continue;
      }
      const ch = text[c]!;
      if (ch === " " || ch === "\t" || ch === "\r") {
        c++;
      } else if (ch === "/" && text[c + 1] === "/") {
        c = text.length; // rest of line is a comment
      } else if (ch === "/" && text[c + 1] === "*") {
        inBlock = true;
        c += 2;
      } else {
        return { line: l, character: c };
      }
    }
    // Ran off the end of the line (or a `//` comment consumed it); the trivia
    // continues on the next line.
    /* c8 ignore next */
    if (l + 1 >= lines.length) break;
    l++;
    c = 0;
  }
  return { line, character };
}

// The dotted access expression ending exactly at a reference's end column
// (e.g. `this._internals.foo` for a reference to `foo`), when the reference
// sits at the end of one. This is the source-text hint `accessAliasesFor`
// resolves into alternate access-path aliases; it is not part of the public
// evidence contract.
function accessExpressionAt(
  line: string | undefined,
  endCol: number,
): string | undefined {
  if (line === undefined) return undefined;
  const match = /[A-Za-z_$][\w$]*(?:\?\.[A-Za-z_$][\w$]*|\.[A-Za-z_$][\w$]*)*$/.exec(
    line.slice(0, endCol),
  );
  return match?.[0];
}

// Classify a reference the same way the static indexer does, but with the
// language server's exact position: a JSX element use (`<Component ...`) is a
// render; an identifier immediately followed by `(` — skipping over a generic
// argument list, so `new Map<K, V>()` and `myFunc<T>()` still count — is an
// invocation (a class becomes an instantiation, anything else a call);
// otherwise the target's kind decides between a type reference, a member
// access, and a generic reference.
//
// `startLine`/`endLine` are deliberately separate: some language servers
// report a multi-line property-access reference (e.g. a receiver on one line
// and `.member(` on the next) with `start` and `end` on different lines, so
// reading the end column against the start line's text would slice into the
// wrong line entirely and silently miss the invocation.
function referenceKind(
  targetKind: GraphNodeKind,
  startLine: string | undefined,
  endLine: string | undefined,
  startCol: number,
  endCol: number,
  multiline: boolean,
  accessText: string | undefined,
): ISamchonGraphEdge["kind"] {
  // The text before the reference (its start already advanced past leading
  // trivia to the real token), trimmed of the whitespace that separates the
  // keyword from the name.
  const before = (
    startLine === undefined ? "" : startLine.slice(0, startCol)
  ).replace(/\s+$/, "");
  // A `new X` expression instantiates X even when a generic argument list
  // (`new Map<K, V>(...)`) pushes the `(` onto a later line the end-line check
  // below can't see; the `new` keyword right before the name is the reliable
  // signal @ttsc/graph reads from its AST NewExpression.
  if (/\bnew$/.test(before)) return "instantiates";
  // A `typeof X` type query depends on X's type — @ttsc/graph records it as a
  // type reference, not the value access X's own kind would otherwise imply.
  if (/\btypeof$/.test(before)) return "type_ref";
  // A JSX tag name never spans lines, so only consider it on a single-line
  // reference: a multi-line reference's start column can land on an unrelated
  // trailing `<` (a comparison / generic on the receiver line) and be misread
  // as a tag.
  if (!multiline && isJsxElementUse(startLine, startCol)) return "renders";
  let after = afterGenericArgs(
    endLine === undefined ? "" : endLine.slice(endCol).trimStart(),
  );
  // An optional call `fn?.()` invokes fn; the `?.` sits between the name and
  // the argument list. (A `?.member` without a following `(` is an access,
  // handled below, so only strip the `?.` when it leads into a call.)
  if (after.startsWith("?.")) after = after.slice(2).trimStart();
  if (after.startsWith("(")) {
    return targetKind === "class" || targetKind === "constructor"
      ? "instantiates"
      : "calls";
  }
  switch (targetKind) {
    case "class":
    case "interface":
    case "type":
    case "enum":
      return "type_ref";
    case "property":
    case "field":
    case "variable":
      return "accesses";
    default:
      // A bare non-call reference resolves by the target's kind above; a
      // callable (method/function/constructor) reached through a member
      // access (`obj.method` without a following `(`, so `accessText` carries
      // the receiver `.member` chain) is a property read, the same
      // value-access @ttsc/graph records, not a generic reference.
      return accessText !== undefined && accessText.includes(".")
        ? "accesses"
        : "references";
  }
}

// A JSX element name immediately follows `<` (opening) or `</` (closing), and
// that `<` is not itself part of a generic/comparison expression (`Array<`,
// `x < y`), which puts an identifier character directly before it.
function isJsxElementUse(
  refLine: string | undefined,
  startCol: number,
): boolean {
  if (refLine === undefined) return false;
  const before = refLine.slice(0, startCol);
  const match = /<\/?$/.exec(before);
  if (match === null) return false;
  const beforeAngle = before[match.index - 1];
  return beforeAngle === undefined || !/[A-Za-z0-9_$]/.test(beforeAngle);
}

// Skip a leading balanced `<...>` generic argument list (`<K, V>` in
// `new Map<K, V>()`), so the invocation check right after can still see the
// `(`. Unmatched (no closing `>` on this line) returns the text unchanged, so
// the caller's `startsWith("(")` check simply fails as it did before.
function afterGenericArgs(text: string): string {
  if (!text.startsWith("<")) return text;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "<") depth++;
    else if (text[i] === ">") {
      depth--;
      if (depth === 0) return text.slice(i + 1).trimStart();
    }
  }
  return text;
}

// Language servers such as rust-analyzer answer requests made during indexing
// with a `ContentModified` error; letting that reject would drop the whole
// language to the static fallback. Retry those fast rejections a few times,
// then treat this target as having no references rather than failing the
// language. A TIMEOUT is different: it already burned the full request timeout,
// so retrying triples the damage — report it so the caller can stop asking.
async function safeReferences(
  client: LspClient,
  params: unknown,
  timeoutMs?: number,
): Promise<ILocation[] | null | "timeout"> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await client.request<ILocation[] | null>(
        "textDocument/references",
        params,
        timeoutMs,
      );
    } catch (error) {
      if ((error as Error).message.startsWith(
        "LSP request timed out",
      )) return "timeout";
      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });
    }
  }
  return null;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const run = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!);
    }
  };
  const lanes = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: lanes }, run));
  return results;
}

function convertSymbols(
  language: GraphLanguage,
  file: string,
  symbols: DocumentSymbolResult,
  text: string,
): ISamchonGraphNode[] {
  const out: ISamchonGraphNode[] = [];
  // ttsc marks a node exported only when its symbol is in the source file's
  // module export table (exports.go/markExports): a class member is never a
  // module export, and a top-level declaration is exported only when the file
  // actually exports it. For a language we have not yet audited against ttsc,
  // keep the prior behavior (every symbol exported) rather than guessing.
  const exportedNames = exportedTopLevelNames(language, text);
  const isExported = (name: string, topLevel: boolean): boolean => {
    if (exportedNames === undefined) return true;
    return topLevel && exportedNames.has(name);
  };
  const visitDocument = (symbol: IDocumentSymbol, owners: string[]): void => {
    const kind = kindOf(symbol.kind);
    if (kind !== undefined) {
      const qualifiedName = [...owners, symbol.name].join(".");
      out.push({
        id: `${file}#${qualifiedName}:${kind}`,
        kind,
        language,
        name: symbol.name,
        ...(owners.length > 0 ? { qualifiedName } : {}),
        file,
        external: false,
        ...(isExported(symbol.name, owners.length === 0)
          ? { exported: true }
          : {}),
        evidence: {
          file,
          startLine: symbol.selectionRange.start.line + 1,
          startCol: symbol.selectionRange.start.character + 1,
          endLine: symbol.range.end.line + 1,
          endCol: symbol.range.end.character + 1,
        },
      });
    }
    for (const child of symbol.children ?? []) {
      visitDocument(
        child,
        kind === undefined ? owners : [...owners, symbol.name],
      );
    }
  };
  for (const symbol of symbols ?? []) {
    if (isDocumentSymbol(symbol)) visitDocument(symbol, []);
    else out.push(convertSymbolInformation(language, file, symbol));
  }
  return out;
}

// The top-level names a TypeScript/JavaScript source file exports, or
// undefined for a language whose export surface we have not modeled (there,
// every symbol keeps the prior exported=true default). Covers the three
// module-export forms an editor's document symbols alone cannot see: an inline
// `export` modifier, a separate `export { a, b as c }` list, and an
// `export default Name`. A cross-file re-export (`export { X } from "./x"`) is
// not resolved here — that would need the whole-program view ttsc's checker
// has — so only names a re-export's own file also declares are caught.
function exportedTopLevelNames(
  language: GraphLanguage,
  text: string,
): Set<string> | undefined {
  if (language !== "typescript") return undefined;
  const names = new Set<string>();
  const inline =
    /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:abstract\s+)?(?:declare\s+)?(?:const|let|var|function\*?|class|interface|type|enum|namespace|module)\s+([A-Za-z_$][\w$]*)/gm;
  for (let m = inline.exec(text); m !== null; m = inline.exec(text)) {
    names.add(m[1]!);
  }
  const list = /export\s+(?:type\s+)?\{([^}]*)\}/g;
  for (let m = list.exec(text); m !== null; m = list.exec(text)) {
    for (const entry of m[1]!.split(",")) {
      const local = entry.trim().split(/\s+as\s+/)[0]?.trim();
      if (local !== undefined && /^[A-Za-z_$][\w$]*$/.test(local)) {
        names.add(local);
      }
    }
  }
  const def = /export\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/gm;
  for (let m = def.exec(text); m !== null; m = def.exec(text)) {
    names.add(m[1]!);
  }
  return names;
}

function convertSymbolInformation(
  language: GraphLanguage,
  file: string,
  symbol: ISymbolInformation,
): ISamchonGraphNode {
  const kind = kindOf(symbol.kind) ?? "external_symbol";
  const owners =
    symbol.containerName === undefined || symbol.containerName === ""
      ? []
      : [symbol.containerName];
  const qualifiedName = [...owners, symbol.name].join(".");
  return {
    id: `${file}#${qualifiedName}:${kind}`,
    kind,
    language,
    name: symbol.name,
    ...(owners.length > 0 ? { qualifiedName } : {}),
    file,
    external: false,
    // The flat SymbolInformation fallback carries no source text to resolve a
    // real export surface; a contained symbol is still never a module export,
    // so only a top-level one keeps the exported default.
    ...(owners.length === 0 ? { exported: true } : {}),
    evidence: {
      file,
      startLine: symbol.location.range.start.line + 1,
      startCol: symbol.location.range.start.character + 1,
      endLine: symbol.location.range.end.line + 1,
      endCol: symbol.location.range.end.character + 1,
    },
  };
}

function kindOf(symbolKind: number): GraphNodeKind | undefined {
  switch (symbolKind) {
    case 2:
      return "module";
    case 3:
      return "namespace";
    case 5:
      return "class";
    case 6:
      return "method";
    case 7:
      return "property";
    case 8:
      return "field";
    case 9:
      return "constructor";
    case 10:
      return "enum";
    case 11:
      return "interface";
    case 12:
      return "function";
    case 13:
    case 14:
      return "variable";
    case 23:
      return "type";
    default:
      return undefined;
  }
}

function ownerAt(nodes: readonly ISamchonGraphNode[], line: number): ISamchonGraphNode | undefined {
  return nodes
    .filter(
      (node) =>
        node.evidence !== undefined &&
        node.evidence.startLine <= line &&
        node.evidence.endLine! >= line,
    )
    .sort(
      (a, b) => {
        const start = b.evidence!.startLine - a.evidence!.startLine;
        if (start !== 0) return start;
        /* c8 ignore next */
        return a.evidence!.endLine! - b.evidence!.endLine!;
      },
    )[0];
}

// The innermost enclosing class/interface at `line`, regardless of whether a
// narrower non-container owner (a method, a property) also covers it. Used
// to find a property/field owner's *own* container, since ttsc attributes a
// non-method member's references to both.
function containerAt(
  nodes: readonly ISamchonGraphNode[],
  line: number,
): ISamchonGraphNode | undefined {
  return nodes
    .filter(
      (node) =>
        (node.kind === "class" || node.kind === "interface") &&
        node.evidence !== undefined &&
        node.evidence.startLine <= line &&
        node.evidence.endLine! >= line,
    )
    .sort((a, b) => b.evidence!.startLine - a.evidence!.startLine)[0];
}
