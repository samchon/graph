const fs = require("node:fs");

let buffer = Buffer.alloc(0);
const failLanguages = new Set();
const languageByUri = new Map();
const options = {
  allSymbolKinds: false,
  badHeader: false,
  emptySymbols: false,
  exitOnInitialize: false,
  messageLessError: false,
  minimalDiagnostics: false,
  nullReferences: false,
  nullSymbols: false,
  omitChildren: false,
  progress: false,
  specialReferences: false,
  stderr: false,
  shutdownError: false,
  symbolInformation: false,
  unknownResponse: false,
  unknownParent: false,
};
let diagnosticSeverities = [2];
let hangMethod;

for (const arg of process.argv.slice(2)) {
  if (arg.startsWith("--fail-language=")) {
    failLanguages.add(arg.slice("--fail-language=".length));
  } else if (arg === "--all-symbol-kinds") {
    options.allSymbolKinds = true;
  } else if (arg === "--bad-header") {
    options.badHeader = true;
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
  } else if (arg === "--null-symbols") {
    options.nullSymbols = true;
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
  } else if (arg.startsWith("--hang-method=")) {
    hangMethod = arg.slice("--hang-method=".length);
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
    if (options.nullReferences) return respond(message.id, null);
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
