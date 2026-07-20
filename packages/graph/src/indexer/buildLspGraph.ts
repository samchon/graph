import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { IDiagnostic, LspClient } from "../lsp";
import { SamchonGraphSourceReader } from "../SamchonGraphSourceReader";
import {
  ISamchonGraphDiagnostic,
  ISamchonGraphDump,
  ISamchonGraphEdge,
  ISamchonGraphNode,
} from "../structures";
import { GraphLanguage } from "../typings";
import { projectRelative, readText } from "../utils/fs";
import { fileFromUri, fileUri, isSubPath } from "../utils/path";
import { IBulkGraphSession } from "../provider/IBulkGraphSession";
import { isBulkGraphSession } from "../provider/isBulkGraphSession";
import { mergeGraphSlices } from "../provider/mergeGraphSlices";
import { TtscGraphClient } from "../provider/ttscgraph/TtscGraphClient";
import { resolveTtscGraphCommand } from "../provider/ttscgraph/resolveTtscGraphCommand";
import { ttscGraphStrictRefusal } from "../provider/ttscgraph/ttscGraphStrictRefusal";
import { appendAll } from "./appendAll";
import { dedupeEdges } from "./dedupeEdges";
import { dedupeNodes } from "./dedupeNodes";
import { ensureCompileCommands } from "./ensureCompileCommands";
import { ensurePubDeps } from "./ensurePubDeps";
import { finalizeGraph } from "./finalizeGraph";
import { IBuildGraphOptions } from "./IBuildGraphOptions";
import { IIndexerResult } from "./IIndexerResult";
import { ILspSession } from "./ILspSession";
import { languageIdOf } from "./languageIdOf";
import { specOf } from "./languages";
import { scanSession } from "./scanSession";
import { IGraphSourceSelection } from "./IGraphSourceSelection";
import { selectGraphSources } from "./selectGraphSources";
import { IStaticGraphParts } from "./IStaticGraphParts";
import { staticGraphParts } from "./staticGraphParts";
import { wireEdges } from "./wireEdges";
import { wireNodes } from "./wireNodes";

interface IBuildLspGraphDependencies {
  resolveTtscGraphCommand: typeof resolveTtscGraphCommand;
  collectTtscGraph: typeof collectTtscGraph;
  collectLanguageGraph: typeof collectLanguageGraph;
}

const DEFAULT_DEPENDENCIES: IBuildLspGraphDependencies = {
  resolveTtscGraphCommand,
  collectTtscGraph,
  collectLanguageGraph,
};

export async function buildLspGraph(
  options: IBuildGraphOptions = {},
  dependencies: Partial<IBuildLspGraphDependencies> = {},
): Promise<IIndexerResult> {
  const resolvedDependencies: IBuildLspGraphDependencies = {
    ...DEFAULT_DEPENDENCIES,
    ...dependencies,
  };
  const root = path.resolve(options.cwd ?? process.cwd());
  const selected = selectGraphSources(root, options);
  const languages = selected.languages;
  const nodes: ISamchonGraphNode[] = [];
  const edges: ISamchonGraphEdge[] = [];
  const strictNodes: ISamchonGraphNode[] = [];
  const strictEdges: ISamchonGraphEdge[] = [];
  const diagnostics: ISamchonGraphDiagnostic[] = [];
  const warnings: string[] = [];
  const staticFallbackLanguages: GraphLanguage[] = [];
  const sessions = new Map<GraphLanguage, ILspSession | IBulkGraphSession>();
  const sources = new Map<string, string>();
  const strictDigests = new Map<
    string,
    IBulkGraphSession.ISourceDigest
  >();
  const snapshotSource = (): SamchonGraphSourceReader =>
    new SamchonGraphSourceReader(root, {
      texts: sources,
      digests: strictDigests,
    });
  let lspNodeCount = 0;
  try {
    // Computed once (not per-language) since cpp and c share the same clangd
    // compilation database and root.
    const compileCommandsDir =
      languages.includes("cpp") || languages.includes("c")
        ? ensureCompileCommands(root, options.cmakeCommand)
        : undefined;
    if (languages.includes("dart")) ensurePubDeps(root, options.pubCommand);

    for (const language of languages) {
      const files = selected.byLanguage.get(language) ?? [];
      if (files.length === 0) continue;
      if (language === "typescript") {
        // The provider decides whether it can honour these options; this loop only
        // reports what it decided. The condition used to live here, inline and
        // without an `else`, which is how the experiment's caps came to disable
        // the compiler-owned lane on every run without a word of explanation.
        const refusal = ttscGraphStrictRefusal(options);
        if (refusal !== undefined) {
          warnings.push(refusal);
        } else {
          const resolved = resolvedDependencies.resolveTtscGraphCommand(root);
          if (resolved !== undefined) {
            try {
              const { result, session } =
                await resolvedDependencies.collectTtscGraph(
                  root,
                  resolved.command,
                  resolved.args,
                  options,
                );
              appendAll(strictNodes, result.nodes);
              appendAll(strictEdges, result.edges);
              appendAll(diagnostics, result.diagnostics);
              appendAll(warnings, result.warnings);
              // The manifest names the files, and the compiler owns the fact that
              // it does. Nothing reads their text here: the strict lane's facts
              // are already resolved, and the only thing the generic lane wanted
              // text for — deriving export edges — is work this provider has
              // already done against the real checker.
              for (const [file, digest] of result.sources) {
                strictDigests.set(file, digest);
              }
              lspNodeCount += result.nodes.length;
              if (options.keepAlive) sessions.set(language, session);
              continue;
            } catch (error) {
              if (options.signal?.aborted) throw error;
              warnings.push(
                `typescript: ttscgraph bulk indexing failed; using ttscserver LSP: ${(error as Error).message}`,
              );
            }
          } else {
            warnings.push(
              "typescript: ttscgraph bulk provider was not found; using ttscserver LSP.",
            );
          }
        }
      }
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
        (language === "cpp" || language === "c") &&
        compileCommandsDir !== undefined
          ? [...baseArgs, `--compile-commands-dir=${compileCommandsDir}`]
          : baseArgs;
      const resolved = resolveCommand(command, root);
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
        : { command: resolved, args: [...args] };
      try {
        const { result, session } =
          await resolvedDependencies.collectLanguageGraph(
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
          for (const opened of session.opened.values()) {
            sources.set(opened.abs, opened.text);
          }
          appendAll(nodes, result.nodes);
          appendAll(edges, result.edges);
          appendAll(diagnostics, result.diagnostics);
          appendAll(warnings, result.warnings);
          lspNodeCount += result.nodes.length;
          if (options.keepAlive) sessions.set(language, session);
        }
      } catch (error) {
        if (options.signal?.aborted) throw error;
        warnings.push(
          `${language}: LSP indexing failed: ${(error as Error).message}`,
        );
        staticFallbackLanguages.push(language);
      }
    }

    // The static lane is merged before the graph is finalized, not after: the
    // export surface is followed once across the whole project, so a barrel in one
    // lane can still publish a symbol declared in the other.
    if (staticFallbackLanguages.length > 0) {
      const fallback = staticGraphParts(
        {
          ...options,
          cwd: root,
          mode: "static",
          languages: staticFallbackLanguages,
        },
        filesForLanguages(selected, staticFallbackLanguages),
      );
      appendSources(sources, fallback.sources);
      if (lspNodeCount === 0) {
        const dump = staticDump(fallback, warnings);
        return {
          dump,
          warnings: dump.warnings ?? [],
          source: snapshotSource(),
          ...(options.keepAlive ? { sessions, sources } : {}),
        };
      }
      appendAll(nodes, fallback.nodes);
      appendAll(edges, fallback.edges);
      appendAll(warnings, fallback.warnings);
    }

    if (nodes.length === 0 && strictNodes.length === 0) {
      const fallback = staticGraphParts(options, selected.files);
      appendSources(sources, fallback.sources);
      const dump = staticDump(fallback, warnings);
      return {
        dump,
        warnings: dump.warnings ?? [],
        source: snapshotSource(),
        ...(options.keepAlive ? { sessions, sources } : {}),
      };
    }

    const finalized = mergeGraphSlices({
      root,
      // Only generic lanes need source-derived export edges. Strict providers
      // already publish compiler-resolved exports, and their complete manifest
      // can contain external or virtual identities that must never be reopened.
      files: [...sources.keys()],
      genericNodes: nodes,
      genericEdges: edges,
      strictNodes,
      strictEdges,
    });
    warnings.push(...finalized.warnings);
    return {
      dump: {
        project: root,
        languages: [
          ...new Set(
            [...strictNodes, ...nodes].map((node) => node.language),
          ),
        ],
        // Only a static fallback makes the graph a hybrid; a benign warning (e.g.
        // the reference cap) on a pure-LSP run must not relabel it.
        indexer: staticFallbackLanguages.length > 0 ? "hybrid" : "lsp",
        nodes: wireNodes(finalized.nodes),
        edges: wireEdges(finalized.edges, finalized.nodes),
        diagnostics,
        warnings,
      },
      warnings,
      source: snapshotSource(),
      ...(options.keepAlive ? { sessions, sources } : {}),
    };
  } catch (error) {
    const closeErrors = await closeKeptSessions(sessions);
    if (closeErrors.length > 0) {
      throw new AggregateError(
        [error, ...closeErrors],
        "@samchon/graph: indexing failed and accumulated sessions could not all close",
      );
    }
    throw error;
  }
}

function filesForLanguages(
  selected: IGraphSourceSelection,
  languages: readonly GraphLanguage[],
): string[] {
  // A fallback language is added only after this exact selection supplied one
  // of its files, so each partition is present here.
  const allowed = new Set(
    languages.flatMap((language) => selected.byLanguage.get(language)!),
  );
  return selected.files.filter((file) => allowed.has(file));
}

async function closeKeptSessions(
  sessions: ReadonlyMap<GraphLanguage, ILspSession | IBulkGraphSession>,
): Promise<Error[]> {
  const failures: Error[] = [];
  for (const session of new Set(sessions.values())) {
    try {
      if (isBulkGraphSession(session)) await session.close();
      else await session.client.close();
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)));
    }
  }
  return failures;
}

async function collectTtscGraph(
  root: string,
  command: string,
  args: readonly string[],
  options: IBuildGraphOptions,
): Promise<{
  result: IBulkGraphSession.ISnapshot;
  session: IBulkGraphSession;
}> {
  const session = new TtscGraphClient({ root, command, args });
  try {
    const result = (await session.refresh({ signal: options.signal })).snapshot;
    if (!options.keepAlive) await session.close();
    return { result, session };
  } catch (error) {
    await session.close();
    throw error;
  }
}

/** Every language fell back to the static parser: the dump is that parse. */
function staticDump(
  parts: IStaticGraphParts,
  warnings: readonly string[],
): ISamchonGraphDump {
  const finalized = finalizeGraph(
    parts.root,
    [...parts.sources.keys()],
    parts.nodes,
    parts.edges,
  );
  const dedupeWarnings = [...finalized.warnings];
  const nodes = dedupeNodes(finalized.nodes, (id, count) =>
    dedupeWarnings.push(
      `@samchon/graph: generic semantic declaration has ${count} locations; retaining canonical declaration and implementation spans: ${id}`,
    ),
  );
  return {
    project: parts.root,
    languages: parts.languages,
    indexer: "static",
    nodes: wireNodes(nodes),
    edges: wireEdges(dedupeEdges(finalized.edges), nodes),
    warnings: [...parts.warnings, ...warnings, ...dedupeWarnings],
  };
}

function appendSources(
  target: Map<string, string>,
  source: ReadonlyMap<string, string>,
): void {
  for (const [file, text] of source) target.set(file, text);
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
  const session = await openLanguageSession(
    root,
    language,
    command,
    args,
    files,
    options,
  );
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
  // Normal callers remain unlimited. Bounded callers such as the real-server
  // experiment can opt into a request deadline.
  const client = new LspClient(command, args, options.lspTimeoutMs, root);
  const diagnostics = new Map<string, ISamchonGraphDiagnostic[]>();
  let lastProgressAt = 0;
  let progressVersion = 0;
  let lastLifecycleEndVersion = 0;
  const activeProgress = new Set<string | number>();
  client.onNotification("$/progress", (params) => {
    lastProgressAt = Date.now();
    progressVersion += 1;
    const progress = params as {
      token?: string | number;
      value?: { kind?: string };
    };
    if (
      typeof progress.token !== "string" &&
      typeof progress.token !== "number"
    ) {
      return;
    }
    if (progress.value?.kind === "begin") {
      activeProgress.add(progress.token);
    } else if (progress.value?.kind === "end") {
      activeProgress.delete(progress.token);
      lastLifecycleEndVersion = progressVersion;
    }
  });
  client.onNotification("textDocument/publishDiagnostics", (params) => {
    const typed = params as { uri?: string; diagnostics?: IDiagnostic[] };
    /* c8 ignore next */
    if (typed.uri === undefined || typed.diagnostics === undefined) return;
    const file = fileFromUri(typed.uri);
    /* c8 ignore next */
    if (!isSubPath(root, file)) return;
    const rel = projectRelative(root, file);
    // A `publishDiagnostics` notification is a *replacement* for the document it
    // names — that is what the protocol says it means — so it replaces. Appending
    // instead kept a re-analysed file's findings twice and a deleted file's
    // forever, and the dump became a function of the session's edit history
    // rather than of the source on disk.
    diagnostics.set(
      rel,
      typed.diagnostics.map((diagnostic) => convertDiagnostic(rel, diagnostic)),
    );
  });

  try {
    await client.request(
      "initialize",
      {
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
      },
      undefined,
      options.signal,
    );
    throwIfAborted(options.signal, "initialization");
    client.notify("initialized", {});

    const quietMs = options.lspReadyQuietMs ?? 1_500;
    const session: ILspSession = {
      client,
      root,
      language,
      opened: new Map(),
      diagnostics,
      progressVersion: () => progressVersion,
      waitForReady: (since, allowStart, signal) =>
        waitForIndexing(
          since,
          allowStart,
          () => progressVersion,
          () => lastProgressAt,
          () => lastLifecycleEndVersion,
          () => activeProgress.size,
          quietMs,
          options.lspReadyTimeoutMs,
          signal,
        ),
    };
    const didOpenFence = session.progressVersion!();
    await openFiles(session, files);

    // Wait for the server's initial indexing BEFORE asking for symbols. Servers
    // that load a project asynchronously differ in how they answer early
    // requests: jdtls blocks them (a longer request timeout suffices), but
    // csharp-ls answers documentSymbol with an empty list until its solution is
    // loaded — collecting symbols first would silently index nothing.
    //
    // The wait ends once progress goes quiet for `lspReadyQuietMs`. Its overall
    // ceiling is optional, so normal callers still wait as long as needed.
    await session.waitForReady!(didOpenFence, true, options.signal);
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
    session.opened.set(rel, { abs, text, version: 1 });
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
  since: number,
  allowStart: boolean,
  currentVersion: () => number,
  lastProgressAt: () => number,
  lastLifecycleEndVersion: () => number,
  activeProgressCount: () => number,
  quietMs: number,
  timeoutMs: number | undefined,
  signal: AbortSignal | undefined,
): Promise<void> {
  const start = Date.now();
  // A work-done `begin` remains active until its matching `end`, even when the
  // server emits no intermediate reports for longer than `quietMs`. Cargo
  // metadata and source-root scans have exactly those silent phases; treating
  // the gap as readiness makes rust-analyzer return valid but empty reference
  // arrays and silently strips every semantic edge from the graph.
  //
  // Some servers only emit `report` notifications, so retain the quiet-period
  // fallback for progress without a lifecycle. A server that never emits
  // progress (lastProgressAt stays 0) is ready after its initial quiet fence.
  // An explicit timeout remains an overall ceiling for both forms.
  // `didOpen` is the one operation for which no progress yet is not evidence
  // of readiness: csharp-ls can begin solution loading more than a second
  // later. Its fence therefore waits one configured quiet window for a begin.
  // A lazy reference request uses `allowStart=false`; it waits only if the
  // request advanced the generation, avoiding another unconditional delay.
  for (;;) {
    throwIfAborted(signal, "indexing readiness");
    const now = Date.now();
    if (timeoutMs !== undefined && now - start >= timeoutMs) return;
    if (activeProgressCount() === 0) {
      // A matching lifecycle `end` is an explicit readiness signal; it does
      // not need an additional quiet delay after the server declared the work
      // complete.
      if (lastLifecycleEndVersion() > since) return;
      if (currentVersion() === since) {
        if (!allowStart || now - start >= quietMs) return;
      } else if (now - lastProgressAt() >= quietMs) return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }
}

function throwIfAborted(
  signal: AbortSignal | undefined,
  phase: string,
): void {
  if (signal?.aborted !== true) return;
  const error = new Error(`LSP request aborted: ${phase}`);
  error.name = "AbortError";
  throw error;
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
    case undefined:
      return undefined;
    /* c8 ignore next 2 */
    default:
      return undefined;
  }
}

function isTtscserverCommand(command: string): boolean {
  return /^ttscserver(?:\.(?:cmd|bat|exe))?$/i.test(path.basename(command));
}

// Resolve a server command to the concrete path PATH lookup would run, so the
// caller can see whether it is a .cmd/.bat shim that needs a cmd.exe wrapper.
function resolveCommand(command: string, root: string): string | undefined {
  if (
    path.isAbsolute(command) ||
    command.includes("/") ||
    command.includes("\\")
  ) {
    const resolved = path.resolve(root, command);
    return fs.existsSync(resolved) ? resolved : undefined;
  }
  /* c8 ignore next 2 */
  const lookup = process.platform === "win32" ? "where.exe" : "command";
  const args = process.platform === "win32" ? [command] : ["-v", command];
  const result = spawnSync(lookup, args, {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${path.join(root, "node_modules", ".bin")}${path.delimiter}${
        /* c8 ignore next */
        process.env.PATH ?? ""
      }`,
    },
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
