import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ILlmController } from "@typia/interface";
import { createMcpServer } from "@typia/mcp";
import typia from "typia";
import {
  AsyncSamchonGraphSource,
  SamchonGraphApplication,
} from "../application";
import { ISamchonGraphApplication } from "../structures";
import { GraphLanguage } from "../typings";
import { languageDisplayNameOf } from "./languageDisplayNameOf";

export function createServer(
  graph: AsyncSamchonGraphSource,
  version: string,
  languages: readonly GraphLanguage[] = [],
): McpServer {
  const controller: ILlmController<ISamchonGraphApplication> = {
    protocol: "class",
    name: "samchon-graph",
    application: namedApplication(
      typia.llm.application<ISamchonGraphApplication>(),
      languageDisplayNameOf(languages),
    ),
    execute: new SamchonGraphApplication(graph),
  };
  return createMcpServer(controller, version);
}

// The description text embeds a `__LANG__` placeholder (see
// ISamchonGraphApplication's JSDoc) wherever the TypeScript-only predecessor
// named "TypeScript" directly; substituting it here — after typia has already
// reflected the JSDoc into the LLM tool schema — names the language a session
// actually indexes instead of staying generic. Mutates description strings in
// place rather than cloning through JSON, since the generated application
// also carries live validator functions a JSON round-trip would drop.
function namedApplication<T extends object>(application: T, name: string): T {
  substituteLang(application, name, new Set());
  return application;
}

// typia's generated LLM schema can share (or, for recursive types like the
// request/result unions here, cycle back through) the same object from
// multiple paths; a plain recursive walk would revisit — or on a true cycle,
// infinitely re-enter — those shared subtrees, so `seen` tracks objects
// already walked and skips them on a repeat visit.
function substituteLang(value: unknown, name: string, seen: Set<object>): void {
  // The only caller passes the top-level application object (never null),
  // and the recursive call below already excludes null before recursing.
  /* c8 ignore next */
  if (value === null || typeof value !== "object") return;
  // Defensive: the current ISamchonGraphApplication schema doesn't actually
  // revisit a shared object (confirmed — this never fires against the real
  // typia output), but nothing guarantees that stays true as the interface
  // evolves, and the alternative on a real cycle is an infinite loop.
  /* c8 ignore next */
  if (seen.has(value)) return;
  seen.add(value);
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const current = record[key];
    if (typeof current === "string") {
      if (current.includes("__LANG__")) {
        record[key] = current.split("__LANG__").join(name);
      }
    } else if (typeof current === "object" && current !== null) {
      substituteLang(current, name, seen);
    }
  }
}
