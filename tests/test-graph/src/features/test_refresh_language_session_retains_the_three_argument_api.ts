import {
  ILspSession,
  LspClient,
  refreshLanguageSession,
} from "@samchon/graph";
import { TestValidator } from "@nestia/e2e";

import { GraphPaths } from "../internal/GraphPaths";

/** The released refresh helper still accepts options without a fourth signal. */
export const test_refresh_language_session_retains_the_three_argument_api =
  async () => {
    const session: ILspSession = {
      client: {
        notify: () => undefined,
      } as unknown as LspClient,
      root: GraphPaths.createTempDirectory("samchon-graph-refresh-api-"),
      language: "typescript",
      opened: new Map(),
      diagnostics: new Map(),
    };

    const result = await refreshLanguageSession(session, [], {});
    TestValidator.equals(
      "a three-argument refresh remains an empty, successful scan",
      result,
      { nodes: [], edges: [], diagnostics: [], warnings: [] },
    );
  };
