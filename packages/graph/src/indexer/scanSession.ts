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
    const converted = convertSymbols(language, openedFile.rel, symbols);
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
      const owner = ownerAt(owners, ref.range.start.line + 1);
      if (owner === undefined || owner.id === target.id) continue;
      const startLineText = linesByFile.get(rel)?.[ref.range.start.line];
      const endLineText =
        ref.range.end.line === ref.range.start.line
          ? startLineText
          : linesByFile.get(rel)?.[ref.range.end.line];
      const accessText = accessExpressionAt(endLineText, ref.range.end.character);
      const kind = referenceKind(
        target.kind,
        startLineText,
        endLineText,
        ref.range.start.character,
        ref.range.end.character,
      );
      const evidence = {
        file: rel,
        startLine: ref.range.start.line + 1,
        startCol: ref.range.start.character + 1,
        endLine: ref.range.end.line + 1,
        endCol: ref.range.end.character + 1,
        // Not part of the public evidence contract; an internal hint
        // `accessAliasesFor` reads via `edgeEvidenceTextOf`.
        ...(accessText !== undefined ? { text: accessText } : {}),
      };
      edges.push({ from: owner.id, to: target.id, kind, evidence });
      // A non-method class/interface member (a property or an arrow-function-
      // valued field) attributes its body's references to both itself AND the
      // enclosing class/interface, not one or the other -- confirmed against
      // @ttsc/graph's own fact-builder (forEachMember walks a property
      // member's subtree once for the member, once for its container). A
      // method is attributed solely to itself.
      if (owner.kind === "property" || owner.kind === "field" || owner.kind === "variable") {
        const container = containerAt(owners, ref.range.start.line + 1);
        if (
          container !== undefined &&
          container.id !== owner.id &&
          container.id !== target.id
        ) {
          edges.push({ from: container.id, to: target.id, kind, evidence });
        }
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
): ISamchonGraphEdge["kind"] {
  if (isJsxElementUse(startLine, startCol)) return "renders";
  const after = afterGenericArgs(
    endLine === undefined ? "" : endLine.slice(endCol).trimStart(),
  );
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
      return "references";
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
): ISamchonGraphNode[] {
  const out: ISamchonGraphNode[] = [];
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
        exported: true,
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
    exported: true,
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
