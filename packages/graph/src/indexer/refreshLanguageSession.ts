import path from "node:path";
import { ISamchonGraphDiagnostic, ISamchonGraphEdge, ISamchonGraphNode } from "../structures";
import { projectRelative, readText } from "../utils/fs";
import { fileUri } from "../utils/path";
import { IBuildGraphOptions } from "./IBuildGraphOptions";
import { ILspSession } from "./ILspSession";
import { languageIdOf } from "./languageIdOf";
import { scanSession } from "./scanSession";

// Re-scans an already-initialized session: reconciles file state against
// disk, then reruns the exact same symbol/reference/edge collection a fresh
// build would. Skips `initialize` entirely, which is the expensive step for
// servers that resolve a whole project (kotlin-language-server's Gradle sync,
// jdtls's workspace import) rather than the reference collection itself.
export async function refreshLanguageSession(
  session: ILspSession,
  files: readonly string[],
  options: IBuildGraphOptions,
  signal?: AbortSignal,
): Promise<{
  nodes: ISamchonGraphNode[];
  edges: ISamchonGraphEdge[];
  diagnostics: ISamchonGraphDiagnostic[];
  warnings: string[];
}> {
  const refreshOptions =
    signal === undefined ? options : { ...options, signal };
  // The session's diagnostics are not cleared: `publishDiagnostics` replaces a
  // document's findings, and a server republishes only what it re-analysed, so
  // what it said about an untouched file still stands. What it said about a file
  // that no longer exists does not, and `reconcileFiles` drops that with the
  // `didClose` it sends.
  const progressFence = session.progressVersion?.();
  const changed = await reconcileFiles(session, files);
  if (
    changed &&
    progressFence !== undefined &&
    session.waitForReady !== undefined
  ) {
    await session.waitForReady(progressFence, true, refreshOptions.signal);
  }
  return scanSession(session, refreshOptions);
}

// Reconciles the session's open files against what is on disk right now:
// changed files get a full-document `didChange`, new files get `didOpen`,
// files that disappeared get `didClose`. Called on refresh only — the initial
// build already opens everything via `openLanguageSession`.
async function reconcileFiles(
  session: ILspSession,
  files: readonly string[],
): Promise<boolean> {
  let changed = false;
  const onDisk = new Set(files.map((abs) => projectRelative(session.root, abs)));
  for (const rel of [...session.opened.keys()]) {
    if (onDisk.has(rel)) continue;
    session.client.notify("textDocument/didClose", {
      textDocument: { uri: fileUri(path.join(session.root, rel)) },
    });
    session.opened.delete(rel);
    changed = true;
    // A file that is gone from disk has no findings, and the dump must not carry
    // the ones it had.
    session.diagnostics.delete(rel);
  }
  for (const abs of files) {
    const text = readText(abs);
    /* c8 ignore next */
    if (text === undefined) continue;
    const rel = projectRelative(session.root, abs);
    const existing = session.opened.get(rel);
    if (existing === undefined) {
      const version = 1;
      session.client.notify("textDocument/didOpen", {
        textDocument: {
          uri: fileUri(abs),
          languageId: languageIdOf(session.language),
          version,
          text,
        },
      });
      session.opened.set(rel, { abs, text, version });
      changed = true;
    } else if (existing.text !== text) {
      const version = existing.version + 1;
      session.client.notify("textDocument/didChange", {
        textDocument: { uri: fileUri(abs), version },
        contentChanges: [{ text }],
      });
      existing.text = text;
      existing.version = version;
      changed = true;
    }
  }
  return changed;
}
