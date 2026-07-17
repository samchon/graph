import { TestValidator } from "@nestia/e2e";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { GraphPaths } from "../internal/GraphPaths";

/**
 * The close handler's diagnostic sink is the last thing standing between a
 * failed resident shutdown and silence. Two properties must hold no matter what
 * the sink does:
 *
 * - a caller that supplies no sink still gets the failure on stderr, rather
 *   than losing it, because `transport.onclose` and stdin `end` do not observe
 *   the returned promise; and
 * - a sink that throws cannot turn a contained close failure back into an
 *   unhandled rejection, and must not stop the shutdown promise from settling.
 */
export const test_mcp_resident_close_handler_contains_diagnostic_sink_failures =
  async () => {
    const module = (await import(
      pathToFileURL(
        path.join(
          GraphPaths.graphPackageRoot,
          "lib",
          "mcp",
          "createResidentCloseHandler.js",
        ),
      ).href
    )) as {
      createResidentCloseHandler(
        resident: { close(): Promise<void> } | undefined,
        report?: (error: unknown) => void,
      ): () => Promise<void>;
    };

    // A resident that is never opened has nothing to close, and asking for
    // shutdown must resolve without inventing work.
    await module.createResidentCloseHandler(undefined)();

    // Without a caller-supplied sink, the default one names the failure on
    // stderr instead of dropping it.
    const failure = new Error("resident close failed");
    const original = console.error;
    const written: unknown[][] = [];
    console.error = (...args: unknown[]) => void written.push(args);
    try {
      await module.createResidentCloseHandler({
        close: () => Promise.reject(failure),
      })();
    } finally {
      console.error = original;
    }
    TestValidator.equals(
      "the default sink reports the close failure once",
      written.length,
      1,
    );
    TestValidator.predicate(
      "the default sink names @samchon/graph and carries the error",
      written[0]?.[0] === "@samchon/graph: failed to close resident graph source." &&
        written[0]?.[1] === failure,
    );

    // A sink that throws must not escalate the contained failure: the shutdown
    // promise still settles, and it settles as fulfilled.
    let reported = 0;
    const settled = await module
      .createResidentCloseHandler(
        { close: () => Promise.reject(failure) },
        () => {
          reported += 1;
          throw new Error("diagnostic sink exploded");
        },
      )()
      .then(
        () => "fulfilled",
        () => "rejected",
      );
    TestValidator.equals("the throwing sink was consulted", reported, 1);
    TestValidator.equals(
      "a throwing diagnostic sink still lets shutdown settle",
      settled,
      "fulfilled",
    );
  };
