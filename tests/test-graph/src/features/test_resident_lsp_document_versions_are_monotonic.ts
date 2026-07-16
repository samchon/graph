import { TestValidator } from "@nestia/e2e";
import { createResidentGraphSource } from "@samchon/graph";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";

interface IDocumentVersionEvent {
  method:
    | "textDocument/didOpen"
    | "textDocument/didChange"
    | "textDocument/didClose";
  uri: string;
  version?: number;
}

const sourceText = (name: string): string =>
  `export function ${name}(): void {}\n`;

export const test_resident_lsp_document_versions_are_monotonic = async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "samchon-graph-lsp-versions-"),
  );
  const sourceDir = path.join(root, "src");
  const a = path.join(sourceDir, "a.ts");
  const b = path.join(sourceDir, "b.ts");
  const log = path.join(root, "document-versions.json");
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(a, sourceText("first"));
  fs.writeFileSync(b, sourceText("stable"));

  const source = createResidentGraphSource({
    cwd: root,
    mode: "lsp",
    languages: ["typescript"],
    server: process.execPath,
    serverArgs: [
      GraphPaths.fakeLspServer,
      `--document-version-log=${log}`,
    ],
    lspTimeoutMs: 2_000,
    lspReadyTimeoutMs: 2_000,
    lspReadyQuietMs: 10,
  });

  try {
    await source.load();
    const afterOpen = readEvents(log);
    await source.load();
    TestValidator.equals(
      "an unchanged snapshot emits no document notification",
      readEvents(log),
      afterOpen,
    );

    fs.writeFileSync(a, sourceText("second"));
    await source.load();
    fs.writeFileSync(a, sourceText("third"));
    await source.load();

    fs.rmSync(b);
    await source.load();
    fs.writeFileSync(b, sourceText("reopened"));
    await source.load();
    const settled = readEvents(log);
    await source.load();
    TestValidator.equals(
      "a settled snapshot leaves every document version unchanged",
      readEvents(log),
      settled,
    );

    TestValidator.equals(
      "successive full-document changes increment exactly once",
      forFile(settled, "a.ts"),
      [
        { method: "textDocument/didOpen", version: 1 },
        { method: "textDocument/didChange", version: 2 },
        { method: "textDocument/didChange", version: 3 },
      ],
    );
    TestValidator.equals(
      "closing and reopening starts a fresh document version lifecycle",
      forFile(settled, "b.ts"),
      [
        { method: "textDocument/didOpen", version: 1 },
        { method: "textDocument/didClose" },
        { method: "textDocument/didOpen", version: 1 },
      ],
    );
  } finally {
    try {
      await source.close();
    } finally {
      fs.rmSync(root, { force: true, recursive: true });
    }
  }
};

const readEvents = (file: string): IDocumentVersionEvent[] =>
  JSON.parse(fs.readFileSync(file, "utf8")) as IDocumentVersionEvent[];

const forFile = (
  events: readonly IDocumentVersionEvent[],
  file: string,
): { method: IDocumentVersionEvent["method"]; version?: number }[] =>
  events
    .filter((event) => event.uri.endsWith(`/${file}`))
    .map((event) => ({
      method: event.method,
      ...(event.version === undefined ? {} : { version: event.version }),
    }));
