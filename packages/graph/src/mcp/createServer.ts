import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ILlmController } from "@typia/interface";
import { createMcpServer } from "@typia/mcp";
import typia from "typia";
import {
  AsyncSamchonGraphSource,
  SamchonGraphApplication,
} from "../application";
import { ISamchonGraphApplication } from "../structures";

export function createServer(
  graph: AsyncSamchonGraphSource,
  version: string,
): McpServer {
  const controller: ILlmController<ISamchonGraphApplication> = {
    protocol: "class",
    name: "samchon-graph",
    application: typia.llm.application<ISamchonGraphApplication>(),
    execute: new SamchonGraphApplication(graph),
  };
  return createMcpServer(controller, version);
}
