import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { IDiagnostic, LspClient } from "../lsp";
import {
  ISamchonGraphDiagnostic,
  ISamchonGraphEdge,
  ISamchonGraphNode,
} from "../structures";
import { GraphLanguage } from "../typings";
import { projectRelative, readText, walkSourceFiles } from "../utils/fs";
import { fileFromUri, fileUri, isSubPath } from "../utils/path";
import { appendAll } from "./appendAll";
import { dedupeEdges } from "./dedupeEdges";
import { dedupeNodes } from "./dedupeNodes";
import { ensureCompileCommands } from "./ensureCompileCommands";
import { IBuildGraphOptions } from "./IBuildGraphOptions";
import { IIndexerResult } from "./IIndexerResult";
import { ILspSession } from "./ILspSession";
import { languageIdOf } from "./languageIdOf";
import { allExtensions, languageOf, specOf } from "./languages";
import { scanSession } from "./scanSession";
import { buildStaticGraph } from "./staticIndexer";

export async function buildLspGraph(
  options: IBuildGraphOptions = {},
): Promise<IIndexerResult> {
  const root = path.resolve(options.cwd ?? process.cwd());
  const languages = options.languages ?? discoverLanguages(root, options);
  const nodes: ISamchonGraphNode[] = [];
  const edges: ISamchonGraphEdge[] = [];
  const diagnostics: ISamchonGraphDiagnostic[] = [];
  const warnings: string[] = [];
  const staticFallbackLanguages: GraphLanguage[] = [];
  const sessions = new Map<GraphLanguage, ILspSession>();
  let lspNodeCount = 0;
  // Computed once (not per-language) since cpp and c share the same clangd
  // compilation database and root.
  const compileCommandsDir =
    languages.includes("cpp") || languages.includes("c")
      ? ensureCompileCommands(root, options.cmakeCommand)
      : undefined;

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
    const baseArgs =
      options.serverArgs ??
      (isTtscserverCommand(command)
        ? [...spec.lsp.args, "--cwd", root]
        : spec.lsp.args);
    // Appended regardless of a custom serverArgs override — which binary to
    // run and which compilation database to hint at are orthogonal, and a
    // test/user overriding serverArgs to swap the server binary should not
    // also have to know to re-specify this.
    const args =
      (language === "cpp" || language === "c") && compileCommandsDir !== undefined
        ? [...baseArgs, `--compile-commands-dir=${compileCommandsDir}`]
        : baseArgs;
    const resolved = resolveCommand(command);
    if (resolved === undefined) {
      warnings.push(`${language}: LSP server not found on PATH: ${command}`);
      staticFallbackLanguages.push(language);
      continue;
    }
    // npm installs Windows servers as .cmd shims, which CreateProcess cannot
    // spawn directly; run those through cmd.exe so ttscserver,
    // pyright-langserver, and friends work from a plain package install.
    const spawnable = /\.(cmd|bat)$/i.test(resolved)
      ? { command: "cmd.exe", args: ["/d", "/s", "/c", resolved, ...args] }
      : { command, args: [...args] };
    try {
      const { result, session } = await collectLanguageGraph(
        root,
        language,
        spawnable.command,
        spawnable.args,
        files,
        options,
      );
      if (result.nodes.length === 0) {
        warnings.push(
          `${language}: LSP returned no symbols; using static fallback.`,
        );
        staticFallbackLanguages.push(language);
        if (options.keepAlive) await session.client.close();
      } else {
        appendAll(nodes, result.nodes);
        appendAll(edges, result.edges);
        appendAll(diagnostics, result.diagnostics);
        appendAll(warnings, result.warnings);
        lspNodeCount += result.nodes.length;
        if (options.keepAlive) sessions.set(language, session);
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
        ...(options.keepAlive ? { sessions } : {}),
      };
    }
    appendAll(nodes, fallback.nodes);
    appendAll(edges, fallback.edges);
    appendAll(warnings, fallback.warnings!);
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
      ...(options.keepAlive ? { sessions } : {}),
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
    ...(options.keepAlive ? { sessions } : {}),
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
  return [
    ...new Set(files.map(languageOf).filter((language) => language !== "unknown")),
  ];
}

// Opens a fresh LSP connection and hands back BOTH the extracted graph slice
// and the live session (opened files, diagnostics buffer). The caller decides
// whether to close the client (a one-shot `dump`) or keep it (a resident
// server, so `refreshLanguageSession` can reuse it later without paying
// `initialize` again — the dominant cost for servers like kotlin-language-server
// that resolve a whole Gradle project before answering it).
async function collectLanguageGraph(
  root: string,
  language: GraphLanguage,
  command: string,
  args: readonly string[],
  files: readonly string[],
  options: IBuildGraphOptions,
): Promise<{
  result: {
    nodes: ISamchonGraphNode[];
    edges: ISamchonGraphEdge[];
    diagnostics: ISamchonGraphDiagnostic[];
    warnings: string[];
  };
  session: ILspSession;
}> {
  const session = await openLanguageSession(root, language, command, args, files, options);
  let result: {
    nodes: ISamchonGraphNode[];
    edges: ISamchonGraphEdge[];
    diagnostics: ISamchonGraphDiagnostic[];
    warnings: string[];
  };
  try {
    result = await scanSession(session, options);
  } catch (error) {
    // A session that failed mid-scan is not safely reusable; close it
    // regardless of keepAlive so a later refresh starts a fresh one instead
    // of leaking this process.
    await session.client.close();
    throw error;
  }
  if (!options.keepAlive) await session.client.close();
  return { result, session };
}

async function openLanguageSession(
  root: string,
  language: GraphLanguage,
  command: string,
  args: readonly string[],
  files: readonly string[],
  options: IBuildGraphOptions,
): Promise<ILspSession> {
  const client = new LspClient(command, args, options.lspTimeoutMs ?? 10_000);
  const diagnostics: ISamchonGraphDiagnostic[] = [];
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
    appendAll(diagnostics, typed.diagnostics.map((diagnostic) => convertDiagnostic(rel, diagnostic)));
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

    const session: ILspSession = {
      client,
      root,
      language,
      opened: new Map(),
      diagnostics,
    };
    await openFiles(session, files);

    // Wait for the server's initial indexing BEFORE asking for symbols. Servers
    // that load a project asynchronously differ in how they answer early
    // requests: jdtls blocks them (a longer request timeout suffices), but
    // csharp-ls answers documentSymbol with an empty list until its solution is
    // loaded — collecting symbols first would silently index nothing.
    //
    // The wait exits early once progress goes quiet for `lspReadyQuietMs`, so
    // this ceiling only costs time on servers that are still actively
    // indexing when it's hit — a large rust-analyzer/clangd/jdtls workspace
    // can still be mid-index at 30s, which silently starves reference
    // collection (see `lspReadyTimeoutMs`'s doc comment) rather than erroring.
    await waitForIndexing(
      () => lastProgressAt,
      options.lspReadyQuietMs ?? 1_500,
      options.lspReadyTimeoutMs ?? 180_000,
    );
    return session;
  } catch (error) {
    // A server that never answers `initialize` (or fails before the session
    // is usable) still holds a live child process; nothing else references
    // this client yet, so this is the only place that can close it before
    // the failure propagates to the static fallback.
    await client.close();
    throw error;
  }
}

// Opens every file for a freshly-initialized session (its `opened` map always
// starts empty; a later refresh reconciles instead of calling this again).
async function openFiles(session: ILspSession, files: readonly string[]): Promise<void> {
  for (const abs of files) {
    const text = readText(abs);
    /* c8 ignore next */
    if (text === undefined) continue;
    const rel = projectRelative(session.root, abs);
    session.opened.set(rel, { abs, text });
    session.client.notify("textDocument/didOpen", {
      textDocument: {
        uri: fileUri(abs),
        languageId: languageIdOf(session.language),
        version: 1,
        text,
      },
    });
  }
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
  await new Promise((resolve) => {
    setTimeout(resolve, Math.min(300, timeoutMs));
  });
  // A server that never emits progress (lastProgressAt stays 0) is treated as
  // ready immediately; one that does is awaited until it stays quiet for
  // `quietMs` or the overall `timeoutMs` cap elapses.
  while (
    lastProgressAt() !== 0 &&
    Date.now() - lastProgressAt() < quietMs &&
    Date.now() - start < timeoutMs
  ) {
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }
}

function convertDiagnostic(file: string, diagnostic: IDiagnostic): ISamchonGraphDiagnostic {
  return {
    file,
    line: diagnostic.range.start.line + 1,
    column: diagnostic.range.start.character + 1,
    code: diagnostic.code ?? diagnostic.source ?? "unknown",
    message: diagnostic.message,
    severity: severityOf(diagnostic.severity),
  };
}

function severityOf(value: number | undefined): ISamchonGraphDiagnostic["severity"] {
  switch (value) {
    case 1:
      return "error";
    case 2:
      return "warning";
    case 3:
      return "info";
    case 4:
      return "hint";
    default:
      return undefined;
  }
}

function isTtscserverCommand(command: string): boolean {
  return /^ttscserver(?:\.(?:cmd|bat|exe))?$/i.test(path.basename(command));
}

// Resolve a server command to the concrete path PATH lookup would run, so the
// caller can see whether it is a .cmd/.bat shim that needs a cmd.exe wrapper.
function resolveCommand(command: string): string | undefined {
  if (
    path.isAbsolute(command) ||
    command.includes("/") ||
    command.includes("\\")
  ) {
    return fs.existsSync(command) ? command : undefined;
  }
  /* c8 ignore next 2 */
  const lookup = process.platform === "win32" ? "where.exe" : "command";
  const args = process.platform === "win32" ? [command] : ["-v", command];
  const result = spawnSync(lookup, args, {
    encoding: "utf8",
    shell: process.platform !== "win32",
    windowsHide: true,
  });
  if (result.status !== 0) return undefined;
  // `where` lists every shim: npm emits an extensionless sh script FIRST, then
  // the .cmd Windows can actually run. Rank Windows-executable extensions ahead
  // of the rest (branchlessly, so every platform exercises the same lines) and
  // take the winner.
  const lines = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const executable = lines.filter((line) => /\.(exe|cmd|bat)$/i.test(line));
  return [...executable, ...lines][0];
}
