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
import { projectRelative, readText, walkSourceFiles } from "../utils/fs";
import { fileFromUri, fileUri, isSubPath } from "../utils/path";
import { allExtensions, languageOf, specOf } from "./languages";
import { buildStaticGraph } from "./staticIndexer";
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
      indexer: warnings.length === 0 ? "lsp" : "hybrid",
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

    const edges: IGraphEdge[] = [];
    const referenceLimit = options.lspReferenceLimit ?? 250;
    const referenceTargets = nodes.slice(0, referenceLimit);
    for (const target of referenceTargets) {
      const evidence = target.evidence!;
      const abs = path.join(root, target.file);
      const refs = await client.request<ILocation[] | null>("textDocument/references", {
        textDocument: { uri: fileUri(abs) },
        position: {
          line: evidence.startLine - 1,
          character: Math.max(0, evidence.startCol! - 1),
        },
        context: { includeDeclaration: false },
      });
      for (const ref of refs ?? []) {
        const refFile = fileFromUri(ref.uri);
        if (!isSubPath(root, refFile)) continue;
        const rel = projectRelative(root, refFile);
        const owners = byFile.get(rel);
        if (owners === undefined) continue;
        const owner = ownerAt(owners, ref.range.start.line + 1);
        if (owner === undefined || owner.id === target.id) continue;
        edges.push({
          from: owner.id,
          to: target.id,
          kind: "references",
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

    return {
      nodes,
      edges,
      diagnostics,
      warnings:
        nodes.length >= referenceLimit
          ? [`${language}: reference collection capped at ${referenceLimit} symbols.`]
          : [],
    };
  } finally {
    await client.close();
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
