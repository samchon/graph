const fs = require("node:fs");

let buffer = Buffer.alloc(0);
let requestId = 0;

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
  if (message.method === "initialize") {
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
    notify("textDocument/publishDiagnostics", {
      uri: message.params.textDocument.uri,
      diagnostics: [
        {
          range: {
            start: { line: 4, character: 0 },
            end: { line: 4, character: 10 },
          },
          severity: 2,
          source: "fake-lsp",
          code: "FAKE001",
          message: "fake warning",
        },
      ],
    });
    return;
  }
  if (message.method === "textDocument/documentSymbol") {
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
      {
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
        children: [],
      },
    ]);
  }
  if (message.method === "textDocument/references") {
    const line = message.params.position.line;
    if (line === 6) {
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
  if (message.method === "shutdown") return respond(message.id, null);
  if (message.method === "exit") process.exit(0);
  if (message.id !== undefined) respond(message.id, null);
}

function respond(id, result) {
  write({ jsonrpc: "2.0", id, result });
}

function notify(method, params) {
  write({ jsonrpc: "2.0", method, params });
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
