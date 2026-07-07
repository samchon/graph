import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  GraphLanguage,
  GraphNodeKind,
  IGraphDiagnostic,
  IGraphDump,
  IGraphEdge,
  IGraphNode,
} from "../structures";
import { LspClient } from "../lsp/LspClient";
import {
  DocumentSymbolResult,
  IDiagnostic,
  IDocumentSymbol,
  ILocation,
  ISymbolInformation,
  isDocumentSymbol,
} from "../lsp/types";
import { isTestPath } from "../operations/isTestPath";
import { projectRelative, readText, walkSourceFiles } from "../utils/fs";
import { fileFromUri, fileUri, isSubPath } from "../utils/path";
import { allExtensions, languageOf, specOf } from "./languages";
import { buildStaticGraph } from "./staticIndexer";
import { decoratorsAbove } from "./decoratorsAbove";
import { overrideEdges } from "./overrideEdges";
import { resolveType } from "./resolveType";
import { supertypesOf } from "./supertypesOf";
import { IBuildGraphOptions } from "./IBuildGraphOptions";
import { IIndexerResult } from "./IIndexerResult";

export async function buildLspGraph(
  options: IBuildGraphOptions = {},
): Promise<IIndexerResult> {
  const root = path.resolve(options.cwd ?? process.cwd());
  const languages = options.languages ?? discoverLanguages(root, options);
  const nodes: IGraphNode[] = [];
  const edges: IGraphEdge[] = [];
  const diagnostics: IGraphDiagnostic[] = [];
  const warnings: string[] = [];
  const staticFallbackLanguages: GraphLanguage[] = [];
  let lspNodeCount = 0;

  for (const language of languages) {
    const files = walkSourceFiles(root, {
      extensions: allExtensions([language]),
      maxFiles: options.maxFiles,
    });
    if (files.length === 0) continue;
    const spec = specOf(language);
    if (spec?.lsp === undefined) {
      warnings.push(`${language}: no built-in LSP server is configured.`);
      staticFallbackLanguages.push(language);
      continue;
    }
    const command = options.server ?? spec.lsp.command;
    const args = options.serverArgs ?? spec.lsp.args;
    if (!hasCommand(command)) {
      warnings.push(`${language}: LSP server not found on PATH: ${command}`);
      staticFallbackLanguages.push(language);
      continue;
    }
    try {
      const result = await collectLanguageGraph(root, language, command, args, files, options);
      if (result.nodes.length === 0) {
        warnings.push(`${language}: LSP returned no symbols; using static fallback.`);
        staticFallbackLanguages.push(language);
      } else {
        nodes.push(...result.nodes);
        edges.push(...result.edges);
        diagnostics.push(...result.diagnostics);
        warnings.push(...result.warnings);
        lspNodeCount += result.nodes.length;
      }
    } catch (error) {
      warnings.push(
        `${language}: LSP indexing failed: ${(error as Error).message}`,
      );
      staticFallbackLanguages.push(language);
    }
  }

  if (staticFallbackLanguages.length > 0) {
    const fallback = buildStaticGraph({
      ...options,
      cwd: root,
      mode: "static",
      languages: staticFallbackLanguages,
    });
    if (lspNodeCount === 0) {
      return {
        dump: {
          ...fallback,
          indexer: "static",
          warnings: [...fallback.warnings!, ...warnings],
        },
        warnings,
      };
    }
    nodes.push(...fallback.nodes);
    edges.push(...fallback.edges);
    warnings.push(...fallback.warnings!);
  }

  if (nodes.length === 0) {
    const fallback = buildStaticGraph(options);
    return {
      dump: {
        ...fallback,
        indexer: "static",
        warnings: [...fallback.warnings!, ...warnings],
      },
      warnings,
    };
  }

  return {
    dump: {
      project: root,
      languages: [...new Set(nodes.map((node) => node.language))],
      generatedAt: new Date().toISOString(),
      // Only a static fallback makes the graph a hybrid; a benign warning (e.g.
      // the reference cap) on a pure-LSP run must not relabel it.
      indexer: staticFallbackLanguages.length > 0 ? "hybrid" : "lsp",
      nodes: dedupeNodes(nodes),
      edges: dedupeEdges(edges),
      diagnostics,
      warnings,
    },
    warnings,
  };
}

function discoverLanguages(
  root: string,
  options: IBuildGraphOptions,
): GraphLanguage[] {
  const files = walkSourceFiles(root, {
    extensions: allExtensions(options.languages),
    maxFiles: options.maxFiles,
  });
  return [...new Set(files.map(languageOf).filter((language) => language !== "unknown"))];
}

async function collectLanguageGraph(
  root: string,
  language: GraphLanguage,
  command: string,
  args: readonly string[],
  files: readonly string[],
  options: IBuildGraphOptions,
): Promise<{
  nodes: IGraphNode[];
  edges: IGraphEdge[];
  diagnostics: IGraphDiagnostic[];
  warnings: string[];
}> {
  const client = new LspClient(command, args, options.lspTimeoutMs ?? 10_000);
  const diagnostics: IGraphDiagnostic[] = [];
  let lastProgressAt = 0;
  client.onNotification("$/progress", () => {
    lastProgressAt = Date.now();
  });
  client.onNotification("textDocument/publishDiagnostics", (params) => {
    const typed = params as { uri?: string; diagnostics?: IDiagnostic[] };
    /* c8 ignore next */
    if (typed.uri === undefined || typed.diagnostics === undefined) return;
    const file = fileFromUri(typed.uri);
    /* c8 ignore next */
    if (!isSubPath(root, file)) return;
    const rel = projectRelative(root, file);
    diagnostics.push(...typed.diagnostics.map((diagnostic) => convertDiagnostic(rel, diagnostic)));
  });

  try {
    await client.request("initialize", {
      processId: process.pid,
      rootUri: fileUri(root),
      initializationOptions: options.initializationOptions,
      capabilities: {
        window: { workDoneProgress: true },
        textDocument: {
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          references: { dynamicRegistration: false },
        },
      },
      workspaceFolders: [{ uri: fileUri(root), name: path.basename(root) }],
    });
    client.notify("initialized", {});

    const nodes: IGraphNode[] = [];
    const byFile = new Map<string, IGraphNode[]>();
    const opened: Array<{ abs: string; rel: string; text: string }> = [];
    for (const abs of files) {
      const text = readText(abs);
      /* c8 ignore next */
      if (text === undefined) continue;
      const rel = projectRelative(root, abs);
      opened.push({ abs, rel, text });
      client.notify("textDocument/didOpen", {
        textDocument: {
          uri: fileUri(abs),
          languageId: languageIdOf(language),
          version: 1,
          text,
        },
      });
    }

    for (const openedFile of opened) {
      const symbols = await client.request<DocumentSymbolResult>(
        "textDocument/documentSymbol",
        { textDocument: { uri: fileUri(openedFile.abs) } },
      );
      const converted = convertSymbols(language, openedFile.rel, symbols);
      byFile.set(openedFile.rel, converted);
      nodes.push(...converted);
    }

    await waitForIndexing(
      () => lastProgressAt,
      options.lspReadyQuietMs ?? 1_500,
      options.lspReadyTimeoutMs ?? 30_000,
    );

    const linesByFile = new Map<string, string[]>();
    for (const openedFile of opened) {
      linesByFile.set(openedFile.rel, openedFile.text.split(/\r?\n/));
    }

    const edges: IGraphEdge[] = [];
    const referenceLimit = options.lspReferenceLimit ?? 250;
    // When the reference budget is smaller than the symbol count, spend it on
    // product code first: test files (spec callbacks and the like) otherwise
    // crowd out the API surface an agent actually asks about.
    const referenceTargets = [...nodes]
      .sort((a, b) => Number(isTestPath(a.file)) - Number(isTestPath(b.file)))
      .slice(0, referenceLimit);
    // Reference requests are independent, so keep several in flight at once;
    // results stay indexed by target order to keep edge output deterministic.
    const referenceResults = await mapWithConcurrency(
      referenceTargets,
      options.lspConcurrency ?? 16,
      (target) => {
        const evidence = target.evidence!;
        const abs = path.join(root, target.file);
        return safeReferences(client, {
          textDocument: { uri: fileUri(abs) },
          position: {
            line: evidence.startLine - 1,
            character: Math.max(0, evidence.startCol! - 1),
          },
          context: { includeDeclaration: false },
        });
      },
    );
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
        const refLine = linesByFile.get(rel)?.[ref.range.start.line];
        edges.push({
          from: owner.id,
          to: target.id,
          kind: referenceKind(target.kind, refLine, ref.range.end.character),
          evidence: {
            file: rel,
            startLine: ref.range.start.line + 1,
            startCol: ref.range.start.character + 1,
            endLine: ref.range.end.line + 1,
            endCol: ref.range.end.character + 1,
          },
        });
      }
    }

    // Make the document-symbol hierarchy explicit: every nested symbol is
    // contained by its owner. The owner is the node whose path is this node's
    // qualified name without its last segment.
    const nodeByPath = new Map<string, IGraphNode>();
    for (const node of nodes) {
      nodeByPath.set(`${node.file}\0${node.qualifiedName ?? node.name}`, node);
    }
    for (const node of nodes) {
      if (node.qualifiedName === undefined) continue;
      const parent = nodeByPath.get(
        `${node.file}\0${node.qualifiedName.slice(0, node.qualifiedName.lastIndexOf("."))}`,
      );
      if (parent === undefined) continue;
      edges.push({ from: parent.id, to: node.id, kind: "contains", evidence: node.evidence });
    }

    // Inheritance: the language server does not report supertypes uniformly
    // (typescript-language-server, for one, has no typeHierarchy), so parse the
    // declaration line the same way the static indexer does and resolve the
    // supertypes against the symbols the server did report.
    const byName = new Map<string, IGraphNode[]>();
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
        edges.push({ from: node.id, to: target.id, kind: supertype.relation, evidence: node.evidence });
      }
    }
    // Decorators sit on the lines directly above a declaration; link the
    // decorated symbol to the decorator it names.
    for (const node of nodes) {
      const fileLines = linesByFile.get(node.file)!;
      for (const name of decoratorsAbove(fileLines, node.evidence!.startLine - 1)) {
        const target = resolveType(name, node, byName);
        if (target === undefined) continue;
        edges.push({ from: node.id, to: target.id, kind: "decorates", evidence: node.evidence });
      }
    }
    edges.push(...overrideEdges(nodes, edges));

    return {
      nodes,
      edges,
      diagnostics,
      warnings:
        nodes.length > referenceLimit
          ? [`${language}: reference collection capped at ${referenceLimit} symbols.`]
          : [],
    };
  } finally {
    await client.close();
  }
}

// Classify a reference the same way the static indexer does, but with the
// language server's exact position: an identifier immediately followed by `(`
// is an invocation (a class becomes an instantiation, anything else a call);
// otherwise the target's kind decides between a type reference, a member
// access, and a generic reference.
function referenceKind(
  targetKind: GraphNodeKind,
  refLine: string | undefined,
  endCol: number,
): IGraphEdge["kind"] {
  const after = refLine === undefined ? "" : refLine.slice(endCol).trimStart();
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

// Language servers such as rust-analyzer answer requests made during indexing
// with a `ContentModified` error; letting that reject would drop the whole
// language to the static fallback. Retry a few times, then treat this target as
// having no references rather than failing the language.
async function safeReferences(
  client: LspClient,
  params: unknown,
): Promise<ILocation[] | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await client.request<ILocation[] | null>("textDocument/references", params);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
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

async function waitForIndexing(
  lastProgressAt: () => number,
  quietMs: number,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  // Give a server that reports `$/progress` a brief window to begin before we
  // conclude it never will; without this a fast documentSymbol phase could race
  // ahead of the first indexing notification.
  await new Promise((resolve) => setTimeout(resolve, Math.min(300, timeoutMs)));
  // A server that never emits progress (lastProgressAt stays 0) is treated as
  // ready immediately; one that does is awaited until it stays quiet for
  // `quietMs` or the overall `timeoutMs` cap elapses.
  while (
    lastProgressAt() !== 0 &&
    Date.now() - lastProgressAt() < quietMs &&
    Date.now() - start < timeoutMs
  ) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function convertSymbols(
  language: GraphLanguage,
  file: string,
  symbols: DocumentSymbolResult,
): IGraphNode[] {
  const out: IGraphNode[] = [];
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
        signature: symbol.detail,
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
      visitDocument(child, kind === undefined ? owners : [...owners, symbol.name]);
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
): IGraphNode {
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

function ownerAt(nodes: readonly IGraphNode[], line: number): IGraphNode | undefined {
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

function convertDiagnostic(file: string, diagnostic: IDiagnostic): IGraphDiagnostic {
  return {
    file,
    message: diagnostic.message,
    severity: severityOf(diagnostic.severity),
    ...(diagnostic.source !== undefined ? { source: diagnostic.source } : {}),
    ...(diagnostic.code !== undefined ? { code: diagnostic.code } : {}),
    evidence: {
      file,
      startLine: diagnostic.range.start.line + 1,
      startCol: diagnostic.range.start.character + 1,
      endLine: diagnostic.range.end.line + 1,
      endCol: diagnostic.range.end.character + 1,
    },
  };
}

function severityOf(value: number | undefined): IGraphDiagnostic["severity"] {
  switch (value) {
    case 1:
      return "error";
    case 2:
      return "warning";
    case 3:
      return "information";
    case 4:
      return "hint";
    default:
      return "information";
  }
}

function languageIdOf(language: GraphLanguage): string {
  if (language === "csharp") return "csharp";
  if (language === "cpp") return "cpp";
  return language;
}

function hasCommand(command: string): boolean {
  if (
    path.isAbsolute(command) ||
    command.includes("/") ||
    command.includes("\\")
  ) {
    return fs.existsSync(command);
  }
  /* c8 ignore next 2 */
  const lookup = process.platform === "win32" ? "where.exe" : "command";
  const args = process.platform === "win32" ? [command] : ["-v", command];
  const result = spawnSync(lookup, args, {
    stdio: "ignore",
    shell: process.platform !== "win32",
    windowsHide: true,
  });
  return result.status === 0;
}

function dedupeNodes(nodes: IGraphNode[]): IGraphNode[] {
  const map = new Map<string, IGraphNode>();
  for (const node of nodes) map.set(node.id, node);
  return [...map.values()];
}

function dedupeEdges(edges: IGraphEdge[]): IGraphEdge[] {
  const map = new Map<string, IGraphEdge>();
  for (const edge of edges) map.set(`${edge.kind}\0${edge.from}\0${edge.to}`, edge);
  return [...map.values()];
}
