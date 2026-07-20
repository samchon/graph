import { TestValidator } from "@nestia/e2e";
import {
  type ILspSession,
  type LspClient,
  scanSession,
} from "@samchon/graph";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { GraphPaths } from "../internal/GraphPaths";

const NORMAL_REQUEST_TIMEOUT_MS = 500;
const WARMUP_TIMEOUT_MS = 1_000;

type ReferenceMode = "requires-patient-budget" | "timeout";

export const test_lsp_mode_warms_up_reference_index = async () => {
  // The first reference request must receive its patient per-request override;
  // later requests deliberately receive no override and use the client's normal
  // deadline. The fake decides synchronously from that contract, so this test
  // cannot fail because the host happened to pause for a wall-clock interval.
  const warm = await scanWarmupFixture({
    first: "requires-patient-budget",
    rest: "requires-patient-budget",
  });
  TestValidator.equals(
    "the warmup budget is more patient than the ordinary request budget",
    WARMUP_TIMEOUT_MS > NORMAL_REQUEST_TIMEOUT_MS,
    true,
  );
  TestValidator.equals(
    "only the first reference request overrides the normal client deadline",
    warm.referenceTimeouts,
    [WARMUP_TIMEOUT_MS, undefined],
  );
  TestValidator.predicate(
    "reference edges were collected after the patient warmup",
    warm.result.edges.some((edge) => edge.kind === "calls"),
  );
  TestValidator.equals(
    "patient warmup keeps the graph available",
    warm.result.warnings,
    [],
  );

  const partial = await scanWarmupFixture({
    first: "requires-patient-budget",
    rest: "timeout",
  });
  TestValidator.equals(
    "the normal deadline remains on later reference requests",
    partial.referenceTimeouts,
    [WARMUP_TIMEOUT_MS, undefined],
  );
  TestValidator.equals(
    "partial timeout keeps the structural graph",
    partial.result.nodes.length,
    2,
  );
  TestValidator.equals(
    "a warm-then-timeout server stays available",
    partial.result.warnings,
    [],
  );

  const unavailable = await scanWarmupFixture({
    first: "timeout",
    rest: "timeout",
  });
  TestValidator.equals(
    "warmup timeout keeps the structural graph",
    unavailable.result.nodes.length,
    2,
  );
  TestValidator.predicate(
    "warmup timeout reports the skipped reference batch",
    unavailable.result.warnings.some((warning) => warning.includes("warmup budget")),
  );
};

async function scanWarmupFixture(options: {
  first: ReferenceMode;
  rest: ReferenceMode;
}): Promise<{
  referenceTimeouts: (number | undefined)[];
  result: Awaited<ReturnType<typeof scanSession>>;
}> {
  const root = GraphPaths.createTempDirectory("samchon-graph-warmup-");
  const file = path.join(root, "index.ts");
  const text =
    "export function caller(): void { target(); }\n" +
    "export function target(): void {}\n";
  fs.writeFileSync(file, text);
  const lines = text.split("\n");
  const referenceStart = lines[0]!.indexOf("target();");
  const symbols = [
    symbol("target", 1, lines[1]!.length),
    symbol("caller", 0, lines[0]!.length),
  ];
  const referenceTimeouts: (number | undefined)[] = [];
  let references = 0;
  const client = {
    request: async <T>(
      method: string,
      _params: unknown,
      timeoutMs?: number,
    ): Promise<T> => {
      if (method === "textDocument/documentSymbol") return symbols as T;
      if (method !== "textDocument/references")
        throw new Error(`unexpected request: ${method}`);
      referenceTimeouts.push(timeoutMs);
      const mode = references++ === 0 ? options.first : options.rest;
      if (mode === "timeout") throw timedOut();
      if (references === 1 && timeoutMs !== WARMUP_TIMEOUT_MS) throw timedOut();
      return [
        {
          uri: pathToFileURL(file).href,
          range: {
            start: { line: 0, character: referenceStart },
            end: { line: 0, character: referenceStart + "target".length },
          },
        },
      ] as T;
    },
  } as unknown as LspClient;
  const session: ILspSession = {
    client,
    root,
    language: "typescript",
    opened: new Map([["index.ts", { abs: file, text, version: 1 }]]),
    diagnostics: new Map(),
  };
  return {
    referenceTimeouts,
    result: await scanSession(session, {
      lspWarmupTimeoutMs: WARMUP_TIMEOUT_MS,
      lspConcurrency: 1,
    }),
  };
}

function symbol(name: string, line: number, end: number): object {
  const start = "export function ".length;
  return {
    name,
    detail: "",
    kind: 12,
    range: {
      start: { line, character: 0 },
      end: { line, character: end },
    },
    selectionRange: {
      start: { line, character: start },
      end: { line, character: start + name.length },
    },
    children: [],
  };
}

function timedOut(): Error {
  return new Error("LSP request timed out: textDocument/references");
}
