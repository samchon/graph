const fs = require("node:fs");

let buffer = Buffer.alloc(0);
const failLanguages = new Set();
const languageByUri = new Map();
const options = {
  allSymbolKinds: false,
  badHeader: false,
  badJson: false,
  emptySymbols: false,
  exitOnInitialize: false,
  messageLessError: false,
  minimalDiagnostics: false,
  nullReferences: false,
  referenceError: false,
  nullSymbols: false,
  classify: false,
  inheritance: false,
  omitChildren: false,
  progress: false,
  specialReferences: false,
  stderr: false,
  shutdownError: false,
  symbolInformation: false,
  unknownResponse: false,
  unknownParent: false,
  changeSymbolsOnRefresh: false,
};
const symbolCallCountByUri = new Map();
let diagnosticSeverities = [2];
let hangMethod;
if (process.env.SAMCHON_GRAPH_FAKE_LSP_ARGS_FILE) {
  fs.writeFileSync(
    process.env.SAMCHON_GRAPH_FAKE_LSP_ARGS_FILE,
    JSON.stringify(process.argv.slice(2)),
  );
}
// Delay only the FIRST textDocument/references response by this many ms, then
// answer the rest immediately — models a server that builds its reference index
// lazily on the first call and serves the rest from cache.
let slowFirstReferencesMs = 0;
let referenceCallCount = 0;
// Answer the first N references (enough to let the warmup succeed) and then go
// silent — models a warm server that still times out on a few later targets.
let hangReferencesAfter = Infinity;

for (const arg of process.argv.slice(2)) {
  if (arg.startsWith("--fail-language=")) {
    failLanguages.add(arg.slice("--fail-language=".length));
  } else if (arg === "--all-symbol-kinds") {
    options.allSymbolKinds = true;
  } else if (arg === "--bad-header") {
    options.badHeader = true;
  } else if (arg === "--bad-json") {
    options.badJson = true;
  } else if (arg === "--empty-symbols") {
    options.emptySymbols = true;
  } else if (arg === "--exit-on-initialize") {
    options.exitOnInitialize = true;
  } else if (arg === "--message-less-error") {
    options.messageLessError = true;
  } else if (arg === "--minimal-diagnostics") {
    options.minimalDiagnostics = true;
  } else if (arg === "--null-references") {
    options.nullReferences = true;
  } else if (arg === "--reference-error") {
    options.referenceError = true;
  } else if (arg === "--null-symbols") {
    options.nullSymbols = true;
  } else if (arg === "--classify") {
    options.classify = true;
  } else if (arg === "--inheritance") {
    options.inheritance = true;
  } else if (arg === "--omit-children") {
    options.omitChildren = true;
  } else if (arg === "--progress") {
    options.progress = true;
  } else if (arg === "--special-references") {
    options.specialReferences = true;
  } else if (arg === "--stderr") {
    options.stderr = true;
  } else if (arg === "--shutdown-error") {
    options.shutdownError = true;
  } else if (arg === "--symbol-information") {
    options.symbolInformation = true;
  } else if (arg === "--unknown-response") {
    options.unknownResponse = true;
  } else if (arg === "--unknown-parent") {
    options.unknownParent = true;
  } else if (arg === "--change-symbols-on-refresh") {
    options.changeSymbolsOnRefresh = true;
  } else if (arg.startsWith("--hang-method=")) {
    hangMethod = arg.slice("--hang-method=".length);
  } else if (arg.startsWith("--slow-first-references=")) {
    slowFirstReferencesMs = Number(arg.slice("--slow-first-references=".length));
  } else if (arg.startsWith("--hang-references-after=")) {
    hangReferencesAfter = Number(arg.slice("--hang-references-after=".length));
  } else if (arg.startsWith("--diagnostic-severities=")) {
    diagnosticSeverities = arg
      .slice("--diagnostic-severities=".length)
      .split(",")
      .map((value) => Number(value));
  }
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) return;
    const header = buffer.slice(0, headerEnd).toString("ascii");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (match === null) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (buffer.length < bodyEnd) return;
    const body = buffer.slice(bodyStart, bodyEnd).toString("utf8");
    buffer = buffer.slice(bodyEnd);
    handle(JSON.parse(body));
  }
});

function handle(message) {
  if (message.method === hangMethod) return;
  if (message.method === "initialize") {
    if (options.exitOnInitialize) process.exit(7);
    if (options.stderr) process.stderr.write("fake-lsp progress\n");
    if (options.badHeader) process.stdout.write("Missing-Length\r\n\r\n");
    if (options.badJson) {
      const bad = "{ not json";
      process.stdout.write(`Content-Length: ${Buffer.byteLength(bad)}\r\n\r\n${bad}`);
    }
    if (options.unknownResponse) respond(999999, { ignored: true });
    return respond(message.id, {
      capabilities: {
        textDocumentSync: 1,
        documentSymbolProvider: true,
        referencesProvider: true,
      },
      serverInfo: { name: "fake-lsp", version: "0.0.0" },
    });
  }
  if (message.method === "initialized") return;
  if (message.method === "textDocument/didOpen") {
    languageByUri.set(
      message.params.textDocument.uri,
      message.params.textDocument.languageId,
    );
    if (options.progress) {
      // Mirror a real server: ask the client to create a progress token (a
      // server-initiated request that must be answered), then report indexing.
      request("window/workDoneProgress/create", { token: "fake-index" });
      notify("$/progress", {
        token: "fake-index",
        value: { kind: "report", message: "indexing" },
      });
    }
    notify("textDocument/publishDiagnostics", {
      uri: message.params.textDocument.uri,
      diagnostics: diagnosticSeverities.map((severity, index) => ({
          range: {
            start: { line: 4 + index, character: 0 },
            end: { line: 4 + index, character: 10 },
          },
          severity,
          ...(options.minimalDiagnostics ? {} : {
            source: "fake-lsp",
            code: `FAKE00${index + 1}`,
          }),
          message: "fake warning",
        })),
    });
    return;
  }
  if (message.method === "textDocument/documentSymbol") {
    const uri = message.params.textDocument.uri;
    const languageId = languageByUri.get(uri);
    if (failLanguages.has(languageId)) {
      return respondError(message.id, `forced ${languageId} failure`);
    }
    if (options.messageLessError) return respondBareError(message.id);
    if (options.emptySymbols) return respond(message.id, []);
    if (options.inheritance) {
      const cls = (name, kind, line) => ({
        name,
        detail: "",
        kind,
        range: { start: { line, character: 0 }, end: { line, character: 60 } },
        selectionRange: { start: { line, character: 13 }, end: { line, character: 13 + name.length } },
        children: [],
      });
      return respond(message.id, [
        cls("Deco", 12, 0),
        cls("Parent", 5, 1),
        cls("Iface", 11, 2),
        cls("Child", 5, 5),
        cls("Solo", 5, 6),
        cls("Dup", 5, 7),
      ]);
    }
    if (options.classify) {
      const leaf = (name, kind, line) => ({
        name,
        detail: "",
        kind,
        range: { start: { line, character: 0 }, end: { line, character: 5 } },
        selectionRange: { start: { line, character: 0 }, end: { line, character: 1 } },
        children: [],
      });
      return respond(message.id, [
        {
          name: "Owner",
          detail: "",
          kind: 5,
          range: { start: { line: 0, character: 0 }, end: { line: 999, character: 1 } },
          selectionRange: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } },
          children: [
            leaf("method", 6, 3),
            leaf("iface", 11, 4),
            leaf("value", 13, 5),
            leaf("ctor", 9, 6),
            leaf("fn", 12, 7),
            leaf("nested", 5, 8),
            leaf("alias", 23, 9),
            leaf("mode", 10, 10),
            leaf("prop", 7, 11),
            leaf("count", 8, 12),
          ],
        },
      ]);
    }
    if (options.nullSymbols) return respond(message.id, null);
    if (options.unknownParent) {
      return respond(message.id, [
        {
          name: "UnknownContainer",
          detail: "unknown container",
          kind: 999,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 4, character: 1 },
          },
          selectionRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 16 },
          },
          children: [
            {
              name: "KnownChild",
              detail: "function KnownChild(): void",
              kind: 12,
              range: {
                start: { line: 1, character: 2 },
                end: { line: 3, character: 3 },
              },
              selectionRange: {
                start: { line: 1, character: 11 },
                end: { line: 1, character: 21 },
              },
            },
          ],
        },
      ]);
    }
    if (options.changeSymbolsOnRefresh) {
      // Models a server whose second `documentSymbol` answer reflects an edit
      // made between builds: the resident source's refresh must call this
      // again (not reuse the first build's symbols) after a file changes.
      const count = (symbolCallCountByUri.get(uri) ?? 0) + 1;
      symbolCallCountByUri.set(uri, count);
      const name = count === 1 ? "FirstHelper" : "SecondHelper";
      return respond(message.id, [
        {
          name,
          detail: `function ${name}(): void`,
          kind: 12,
          range: { start: { line: 6, character: 0 }, end: { line: 8, character: 1 } },
          selectionRange: {
            start: { line: 6, character: 16 },
            end: { line: 6, character: 16 + name.length },
          },
          children: [],
        },
      ]);
    }
    if (options.allSymbolKinds) {
      const kinds = [2, 3, 7, 8, 9, 10, 11, 13, 14, 23, 999];
      return respond(message.id, kinds.map((kind, index) => ({
        name: `Kind${kind}`,
        kind,
        containerName: index % 2 === 0 ? "AllKinds" : "",
        location: {
          uri,
          range: {
            start: { line: index, character: 0 },
            end: { line: index, character: 8 },
          },
        },
      })));
    }
    if (options.symbolInformation) {
      return respond(message.id, [
        {
          name: "LspInformation",
          kind: 12,
          containerName: "InformationContainer",
          location: {
            uri,
            range: {
              start: { line: 6, character: 16 },
              end: { line: 8, character: 1 },
            },
          },
        },
      ]);
    }
    const helper = {
      name: "helper",
      detail: "function helper(): void",
      kind: 12,
      range: {
        start: { line: 6, character: 0 },
        end: { line: 8, character: 1 },
      },
      selectionRange: {
        start: { line: 6, character: 16 },
        end: { line: 6, character: 22 },
      },
      ...(options.omitChildren ? {} : { children: [] }),
    };
    return respond(message.id, [
      {
        name: "LspService",
        detail: "class LspService",
        kind: 5,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 5, character: 1 },
        },
        selectionRange: {
          start: { line: 0, character: 13 },
          end: { line: 0, character: 23 },
        },
        children: [
          {
            name: "run",
            detail: "run(): void",
            kind: 6,
            range: {
              start: { line: 1, character: 2 },
              end: { line: 3, character: 3 },
            },
            selectionRange: {
              start: { line: 1, character: 2 },
              end: { line: 1, character: 5 },
            },
            children: [],
          },
        ],
      },
      helper,
    ]);
  }
  if (message.method === "textDocument/references") {
    if (options.referenceError) return respondError(message.id, "content modified");
    if (options.nullReferences) return respond(message.id, null);
    referenceCallCount += 1;
    if (referenceCallCount > hangReferencesAfter) return;
    if (slowFirstReferencesMs > 0 && referenceCallCount === 1) {
      // The first call is delayed past a short per-request timeout but within a
      // patient warmup budget; the harness must wait it out, then the batch is
      // instant. Re-dispatch after the delay with the delay disabled.
      const delay = slowFirstReferencesMs;
      slowFirstReferencesMs = 0;
      setTimeout(() => handle(message), delay);
      return;
    }
    if (options.classify) {
      const uri = message.params.textDocument.uri;
      const at = (line) => ({
        uri,
        range: {
          start: { line, character: 0 },
          end: { line, character: 4 },
        },
      });
      // line 1: invocation (`(` after col 4), line 2: bare access, line 500:
      // beyond the file so the classifier sees no source text.
      return respond(message.id, [at(1), at(2), at(500)]);
    }
    const line = message.params.position.line;
    if (line === 6) {
      if (options.specialReferences) {
        return respond(message.id, [
          {
            uri: "file:///outside.ts",
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 1 },
            },
          },
          {
            uri: message.params.textDocument.uri,
            range: {
              start: { line: 6, character: 16 },
              end: { line: 6, character: 22 },
            },
          },
          {
            uri: message.params.textDocument.uri,
            range: {
              start: { line: 99, character: 0 },
              end: { line: 99, character: 1 },
            },
          },
          {
            uri: message.params.textDocument.uri.replace(/\/[^/]*$/, "/unopened.ts"),
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 1 },
            },
          },
        ]);
      }
      return respond(message.id, [
        {
          uri: message.params.textDocument.uri,
          range: {
            start: { line: 2, character: 4 },
            end: { line: 2, character: 10 },
          },
        },
      ]);
    }
    return respond(message.id, []);
  }
  if (message.method === "shutdown") {
    if (options.shutdownError) return respondError(message.id, "shutdown failed");
    return respond(message.id, null);
  }
  if (message.method === "exit") process.exit(0);
  if (message.id !== undefined) respond(message.id, null);
}

function respond(id, result) {
  write({ jsonrpc: "2.0", id, result });
}

function respondError(id, message) {
  write({ jsonrpc: "2.0", id, error: { code: -32000, message } });
}

function respondBareError(id) {
  write({ jsonrpc: "2.0", id, error: { code: -32000 } });
}

function notify(method, params) {
  write({ jsonrpc: "2.0", method, params });
}

let serverRequestId = 100000;
function request(method, params) {
  write({ jsonrpc: "2.0", id: serverRequestId++, method, params });
}

function write(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

process.on("uncaughtException", (error) => {
  fs.writeSync(2, `${error.stack || error.message}\n`);
  process.exit(1);
});
