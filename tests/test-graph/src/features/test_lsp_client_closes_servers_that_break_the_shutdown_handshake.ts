import { TestValidator } from "@nestia/e2e";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { GraphPaths } from "../internal/GraphPaths";

interface ILspClient {
  request<T>(method: string, params: unknown, timeoutMs?: number): Promise<T>;
  close(): Promise<void>;
}

/** `LspClient` is internal transport, reached through the shipped artifact. */
const importLib = <T>(relative: string): Promise<T> =>
  import(
    pathToFileURL(path.join(GraphPaths.graphPackageRoot, "lib", relative)).href
  ) as Promise<T>;

export const test_lsp_client_closes_servers_that_break_the_shutdown_handshake =
  async () => {
    const { LspClient } = await importLib<{
      LspClient: new (
        command: string,
        args: readonly string[],
        timeoutMs?: number,
        cwd?: string,
      ) => ILspClient;
    }>("lsp/LspClient.js");

    // A language server that acknowledges `shutdown` and then ignores `exit` is
    // the leak this teardown exists to prevent: nothing else ends that process,
    // so an orphaned server would outlive the session that spawned it, holding
    // a whole Gradle or solution load resident behind a session nobody is
    // talking to. The client waits briefly, then kills it.
    const stubborn = new LspClient(process.execPath, [
      GraphPaths.fakeLspServer,
      "--hang-method=exit",
    ]);
    await stubborn.request("initialize", {});
    // An `exit` request is never answered by this server, so it is still in
    // flight when the child dies — which is what makes the rejection below
    // evidence of how the child died rather than of how it replied.
    let stranded: Error | undefined;
    const settled = stubborn
      .request("exit", null)
      .catch((error: Error) => void (stranded = error));
    await stubborn.close();
    await settled;
    // A request the server can no longer answer must be told so. Left pending,
    // it would hang whatever awaited it for the life of the process.
    TestValidator.predicate(
      "a server that ignores exit is killed, and its in-flight requests are told",
      stranded !== undefined &&
        stranded.message.includes("Language server exited"),
    );
    // `null` exit code with a signal is precisely the fingerprint of a process
    // the client terminated, as opposed to one that chose to leave.
    TestValidator.predicate(
      "the stranded request names the signal the client had to send",
      stranded !== undefined && /\(null, SIG[A-Z]+\)/.test(stranded.message),
    );

    // The opposite break: a server that treats `shutdown` as the end and exits
    // instead of replying. It is already gone before `exit` is written, so a
    // close that still waited out its exit grace would stall every teardown by
    // a full second for nothing.
    const abrupt = new LspClient(process.execPath, [
      GraphPaths.fakeLspServer,
      "--exit-on-shutdown",
    ]);
    await abrupt.request("initialize", {});
    const started = Date.now();
    await abrupt.close();
    TestValidator.predicate(
      "a server that exits on shutdown is not waited on again",
      Date.now() - started < 900,
    );

    // Teardown is idempotent: the resident source closes its sessions, and a
    // second close from a racing shutdown path must settle rather than start a
    // new handshake with a process that is gone.
    await abrupt.close();
    await stubborn.close();
  };
